/* ═══════════════════════════════════════════════════════════════
   Junior Salud — Chatbot de WhatsApp para gestión de citas
   Plataforma: Cloudflare Workers + Meta WhatsApp Cloud API
   ═══════════════════════════════════════════════════════════════ */

const GRAPH_API = "https://graph.facebook.com/v21.0";

const ESPECIALIDADES = [
  "Psiquiatría",
  "Psiquiatría Pediátrica",
  "Psicología",
  "Neuropsicología",
  "Terapia Ocupacional",
  "Terapia de Integración Sensorial",
];

// Títulos cortos para las listas de WhatsApp (máx. 24 caracteres)
const ESPECIALIDADES_CORTAS = [
  "Psiquiatría",
  "Psiquiatría Pediátrica",
  "Psicología",
  "Neuropsicología",
  "Terapia Ocupacional",
  "Integración Sensorial",
];

const INFO_CLINICA = {
  nombre: "Junior Salud",
  direccion: "Calle 19 No. 7A-46, Barrio Quirinal, Neiva, Huila",
  horarios: "Lunes a Viernes: 7:00 am – 6:00 pm\nSábados: 8:00 am – 12:00 m",
  telefonos: "321 919 2374 — 310 240 9324",
};

/* ─────────────────────────────────────────────────────────────
   Entrada principal del Worker
   ───────────────────────────────────────────────────────────── */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname !== "/webhook") {
      return new Response("Junior Salud Bot ✅", { status: 200 });
    }

    // Verificación del webhook (Meta la hace una sola vez al configurar)
    if (request.method === "GET") {
      const mode = url.searchParams.get("hub.mode");
      const token = url.searchParams.get("hub.verify_token");
      const challenge = url.searchParams.get("hub.challenge");
      if (mode === "subscribe" && token === env.VERIFY_TOKEN) {
        return new Response(challenge, { status: 200 });
      }
      return new Response("Forbidden", { status: 403 });
    }

    // Recepción de mensajes
    if (request.method === "POST") {
      // Leer el body ANTES de responder (requisito de Cloudflare Workers)
      let body = null;
      try {
        body = await request.json();
      } catch (e) {
        console.error("Body inválido:", e);
        return new Response("EVENT_RECEIVED", { status: 200 });
      }
      console.log("WEBHOOK BODY:", JSON.stringify(body).slice(0, 500));
      ctx.waitUntil(procesarMensajes(body, env));
      return new Response("EVENT_RECEIVED", { status: 200 });
    }

    return new Response("Method not allowed", { status: 405 });
  },
};

/* ─────────────────────────────────────────────────────────────
   Procesar los mensajes entrantes
   ───────────────────────────────────────────────────────────── */
async function procesarMensajes(body, env) {
  const cambios = body?.entry?.[0]?.changes?.[0]?.value;
  const mensajes = cambios?.messages;
  if (!mensajes || mensajes.length === 0) return; // ej. notificaciones de "leído"

  for (const msg of mensajes) {
    const de = msg.from; // número del paciente (wa_id)
    const texto = normalizarEntrada(msg);
    console.log(`MSG de=${de} tipo=${msg.type} texto=${texto}`);
    if (!texto) continue;

    try {
      await manejarMensaje(de, texto, env);
    } catch (err) {
      console.error("Error manejando mensaje:", err);
    }
  }
}

// Convierte cualquier tipo de mensaje (texto, botón, lista) en un texto simple
function normalizarEntrada(msg) {
  if (msg.type === "text") return msg.text.body.trim();
  if (msg.type === "interactive") {
    const inter = msg.interactive;
    if (inter.type === "button_reply") return inter.button_reply.id;
    if (inter.type === "list_reply") return inter.list_reply.id;
  }
  return null;
}

/* ─────────────────────────────────────────────────────────────
   Sesiones (estado de la conversación) en Cloudflare D1
   Lectura/escritura consistente en tiempo real
   ───────────────────────────────────────────────────────────── */
async function obtenerSesion(env, de) {
  const fila = await env.DB.prepare(
    "SELECT paso, datos FROM sesiones WHERE telefono = ?"
  ).bind(de).first();
  if (!fila) return { paso: "INICIO", datos: {} };
  let datos = {};
  try { datos = JSON.parse(fila.datos); } catch { datos = {}; }
  return { paso: fila.paso, datos };
}

async function guardarSesion(env, de, sesion) {
  await env.DB.prepare(
    `INSERT INTO sesiones (telefono, paso, datos, actualizado)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(telefono) DO UPDATE SET
       paso = excluded.paso,
       datos = excluded.datos,
       actualizado = excluded.actualizado`
  ).bind(
    de,
    sesion.paso,
    JSON.stringify(sesion.datos),
    new Date().toISOString()
  ).run();
}

/* ─────────────────────────────────────────────────────────────
   Lógica principal del bot (máquina de estados)
   ───────────────────────────────────────────────────────────── */
async function manejarMensaje(de, texto, env) {
  const sesion = await obtenerSesion(env, de);
  console.log(`SESION de=${de} paso=${sesion.paso}`);
  const t = texto.toLowerCase();

  // Comandos globales disponibles en cualquier momento
  if (["menu", "menú", "inicio", "volver"].includes(t)) {
    sesion.paso = "MENU";
    await enviarMenuPrincipal(de, env);
    await guardarSesion(env, de, sesion);
    return;
  }

  // Comando exclusivo de la asesora: ver solicitudes pendientes
  if (de === env.ASESOR_NUMBER && t === "solicitudes") {
    await enviarSolicitudes(de, env);
    return;
  }

  switch (sesion.paso) {
    /* ── 1. Consentimiento de datos (Ley 1581 de 2012) ── */
    case "INICIO": {
      await enviarTexto(
        de,
        `👋 ¡Hola! Bienvenido(a) a *${INFO_CLINICA.nombre}* — Clínica Especializada en Salud Mental 🌿\n\n` +
          `Antes de continuar: en cumplimiento de la *Ley 1581 de 2012* (protección de datos personales), ` +
          `necesitamos tu autorización para tratar los datos que nos compartas en este chat. ` +
          `Solo serán usados para gestionar tu cita.\n\n¿Autorizas el tratamiento de tus datos?`,
        env
      );
      await enviarBotones(de, "¿Autorizas el tratamiento de tus datos personales?", [
        { id: "CONSENT_SI", titulo: "✅ Sí, autorizo" },
        { id: "CONSENT_NO", titulo: "❌ No autorizo" },
      ], env);
      sesion.paso = "CONSENTIMIENTO";
      break;
    }

    case "CONSENTIMIENTO": {
      if (texto === "CONSENT_SI" || ["si", "sí", "autorizo"].includes(t)) {
        sesion.datos.consentimiento = true;
        sesion.paso = "MENU";
        await enviarMenuPrincipal(de, env);
      } else if (texto === "CONSENT_NO" || t === "no") {
        await enviarTexto(
          de,
          "Entendido 🙏 Sin autorización no podemos gestionar tu solicitud por este medio.\n\n" +
            `Puedes comunicarte directamente al 📞 ${INFO_CLINICA.telefonos}.\n\n` +
            "Si cambias de opinión, escríbenos de nuevo.",
          env
        );
        sesion.paso = "INICIO";
      } else {
        await enviarTexto(de, "Por favor responde *Sí* o *No* para continuar.", env);
      }
      break;
    }

    /* ── 2. Menú principal ── */
    case "MENU": {
      // Cambios o cancelaciones: los gestiona la asesora directamente
      const quiereCambiar = ["cancelar", "cancela", "reagendar", "reprogramar", "cambiar cita", "cambiar la cita", "modificar cita", "confirmar cita", "confirmar"]
        .some((k) => t.includes(k));

      if (texto === "OP_AGENDAR" || t === "1") {
        sesion.paso = "AGENDAR_NOMBRE";
        sesion.datos = { consentimiento: true };
        await enviarTexto(
          de,
          "📋 Vamos a agendar tu cita. Te haré unas preguntas rápidas.\n\n" +
            "1️⃣ ¿Cuál es tu *nombre completo*? (o el del paciente)",
          env
        );
      } else if (texto === "OP_INFO" || t === "2") {
        await enviarInfo(de, env);
        await enviarMenuPrincipal(de, env);
      } else if (quiereCambiar) {
        sesion.paso = "ESPERANDO_ASESOR";
        await enviarTexto(
          de,
          "🔄 Para *cambiar o cancelar* una cita, nuestra asesora te ayuda directamente.\n\n" +
            "Cuéntame brevemente qué necesitas (ej: *quiero cancelar mi cita del martes*) y le paso tu mensaje. " +
            "También puedes escribirnos al 📞 321 919 2374 — 310 240 9324.",
          env
        );
      } else if (texto === "OP_ASESOR" || t === "3") {
        sesion.paso = "ESPERANDO_ASESOR";
        await enviarTexto(
          de,
          "👩‍⚕️ Ya le avisé a nuestra asesora. Te responderá *personalmente* lo antes posible.\n\n" +
            `⏰ Horario de atención:\n${INFO_CLINICA.horarios}\n\n` +
            "Escribe *menú* si quieres volver al inicio.",
          env
        );
        await notificarAsesora(
          env,
          `🔔 *Paciente solicita hablar con asesora*\n📱 Número: +${de}\n` +
            `Responde directamente en WhatsApp Business o escribe *solicitudes* aquí.`
        );
      } else {
        await enviarMenuPrincipal(de, env);
      }
      break;
    }

    /* ── 3. Flujo de agendamiento ── */
    case "AGENDAR_NOMBRE": {
      sesion.datos.nombre = capitalizar(texto);
      sesion.paso = "AGENDAR_DOC";
      await enviarTexto(de, "2️⃣ Escribe tu *número de documento* de identidad.", env);
      break;
    }

    case "AGENDAR_DOC": {
      if (!/^\d{5,15}$/.test(texto.replace(/\s/g, ""))) {
        await enviarTexto(de, "⚠️ Escribe solo los *números* del documento (sin puntos ni letras).", env);
        break;
      }
      sesion.datos.documento = texto.replace(/\s/g, "");
      sesion.paso = "AGENDAR_FECHA_NAC";
      await enviarTexto(de, "3️⃣ ¿Cuál es tu *fecha de nacimiento*? (ej: 15/03/1990)", env);
      break;
    }

    case "AGENDAR_FECHA_NAC": {
      sesion.datos.fechaNacimiento = texto;
      sesion.paso = "AGENDAR_EPS";
      await enviarTexto(de, "4️⃣ ¿A qué *EPS* perteneces? (si eres particular, escribe *particular*)", env);
      break;
    }

    case "AGENDAR_EPS": {
      sesion.datos.eps = capitalizar(texto);
      sesion.paso = "AGENDAR_AUTORIZACION";
      await enviarTexto(
        de,
        "5️⃣ ¿Cuál es el *número de autorización de tu EPS*?\n\n" +
          "_(Si aún no tienes autorización, eres particular o no aplica, escribe *N/A*)_",
        env
      );
      break;
    }

    case "AGENDAR_AUTORIZACION": {
      const valor = texto.trim();
      const sinAutorizacion = [
        "n/a", "na", "no aplica", "no", "ninguno", "ninguna", "no tengo",
        "particular", "pacticular", "sin autorizacion", "sin autorización", "-",
      ];
      sesion.datos.autorizacion = sinAutorizacion.includes(valor.toLowerCase())
        ? "No aplica"
        : valor.toUpperCase();
      sesion.paso = "AGENDAR_SERVICIO";
      await enviarLista(
        de,
        "6️⃣ ¿Para qué *servicio* necesitas la cita?",
        "Ver servicios",
        ESPECIALIDADES_CORTAS.map((s, i) => ({ id: `SERV_${i}`, titulo: s })),
        env
      );
      break;
    }

    case "AGENDAR_SERVICIO": {
      let servicio = null;
      if (texto.startsWith("SERV_")) {
        servicio = ESPECIALIDADES[parseInt(texto.replace("SERV_", ""), 10)];
      } else {
        servicio = ESPECIALIDADES.find((s) => s.toLowerCase().includes(t));
      }
      if (!servicio) {
        await enviarTexto(de, "⚠️ Elige un servicio de la lista, por favor.", env);
        await enviarLista(
          de,
          "¿Para qué servicio necesitas la cita?",
          "Ver servicios",
          ESPECIALIDADES_CORTAS.map((s, i) => ({ id: `SERV_${i}`, titulo: s })),
          env
        );
        break;
      }
      sesion.datos.servicio = servicio;
      sesion.paso = "AGENDAR_PREFERENCIA";
      await enviarTexto(
        de,
        "7️⃣ ¿Qué *día y hora* te gustaría? (ej: *martes en la mañana* o *15 de octubre a las 2 pm*)\n\n" +
          `⏰ Recuerda nuestro horario:\n${INFO_CLINICA.horarios}`,
        env
      );
      break;
    }

    case "AGENDAR_PREFERENCIA": {
      sesion.datos.preferencia = texto;
      sesion.paso = "AGENDAR_CONFIRMACION";
      const d = sesion.datos;
      await enviarBotones(
        de,
        `📋 *Resumen de tu solicitud:*\n\n` +
          `👤 Nombre: ${d.nombre}\n` +
          `🪪 Documento: ${d.documento}\n` +
          `🎂 F. nacimiento: ${d.fechaNacimiento}\n` +
          `🏥 EPS: ${d.eps}\n` +
          `🔐 N° autorización EPS: ${d.autorizacion || "No aplica"}\n` +
          `🩺 Servicio: ${d.servicio}\n` +
          `📅 Preferencia: ${d.preferencia}\n\n` +
          `¿Confirmas el envío de tu solicitud?`,
        [
          { id: "CONF_SI", titulo: "✅ Confirmar" },
          { id: "CONF_NO", titulo: "🔁 Corregir" },
        ],
        env
      );
      break;
    }

    case "AGENDAR_CONFIRMACION": {
      if (texto === "CONF_SI" || ["si", "sí", "confirmar"].includes(t)) {
        const solicitud = {
          ...sesion.datos,
          telefono: de,
          fecha: new Date().toLocaleString("es-CO", { timeZone: "America/Bogota" }),
          tipo: "NUEVA CITA",
        };
        await registrarSolicitud(env, solicitud);
        await notificarAsesora(env, formatearSolicitud(solicitud));
        await enviarTexto(
          de,
          "✅ *¡Solicitud enviada con éxito!*\n\n" +
            "Nuestra asesora revisará la disponibilidad y te confirmará la fecha y hora de tu cita " +
            "*por este mismo chat* lo antes posible. 🌿\n\n" +
            `📞 Si es urgente: ${INFO_CLINICA.telefonos}\n` +
            "Escribe *menú* para volver al inicio.",
          env
        );
        sesion.paso = "MENU";
      } else {
        sesion.paso = "AGENDAR_NOMBRE";
        await enviarTexto(de, "🔁 Sin problema, empecemos de nuevo.\n\n1️⃣ ¿Cuál es tu *nombre completo*?", env);
      }
      break;
    }

    /* ── 4. Esperando asesora humana ── */
    case "ESPERANDO_ASESOR": {
      // El paciente sigue escribiendo: reenviamos el mensaje a la asesora
      await notificarAsesora(env, `💬 *Mensaje del paciente* +${de}:\n"${texto}"`);
      await enviarTexto(de, "📨 Mensaje enviado a la asesora. Te responderá pronto por aquí. 🙏", env);
      break;
    }

    default: {
      sesion.paso = "INICIO";
      await manejarMensaje(de, texto, env);
      return;
    }
  }

  await guardarSesion(env, de, sesion);
}

/* ─────────────────────────────────────────────────────────────
   Mensajes prearmados
   ───────────────────────────────────────────────────────────── */
async function enviarMenuPrincipal(de, env) {
  await enviarLista(
    de,
    `🌿 *${INFO_CLINICA.nombre}* — "Tu salud mental es nuestra prioridad"\n\n¿En qué te puedo ayudar hoy?\n\n_(Para cambiar o cancelar una cita, elige “Hablar con asesora”)_`,
    "Ver opciones",
    [
      { id: "OP_AGENDAR", titulo: "📅 Agendar cita" },
      { id: "OP_INFO", titulo: "ℹ️ Horarios y ubicación" },
      { id: "OP_ASESOR", titulo: "👩‍⚕️ Hablar con asesora" },
    ],
    env
  );
}

async function enviarInfo(de, env) {
  await enviarTexto(
    de,
    `ℹ️ *Información de ${INFO_CLINICA.nombre}*\n\n` +
      `📍 Dirección: ${INFO_CLINICA.direccion}\n\n` +
      `⏰ Horarios:\n${INFO_CLINICA.horarios}\n\n` +
      `📞 Teléfonos: ${INFO_CLINICA.telefonos}\n\n` +
      `🛡️ IPS Habilitada · Resolución 3100 de 2019`,
    env
  );
}

/* ─────────────────────────────────────────────────────────────
   Solicitudes: guardar y consultar
   ───────────────────────────────────────────────────────────── */
async function registrarSolicitud(env, solicitud) {
  await env.DB.prepare(
    "INSERT INTO solicitudes (tipo, payload, creado) VALUES (?, ?, ?)"
  ).bind(
    solicitud.tipo,
    JSON.stringify(solicitud),
    new Date().toISOString()
  ).run();
}

async function enviarSolicitudes(de, env) {
  const { results } = await env.DB.prepare(
    "SELECT payload FROM solicitudes ORDER BY id DESC LIMIT 10"
  ).all();
  if (!results || results.length === 0) {
    await enviarTexto(de, "📭 No hay solicitudes registradas por el bot todavía.", env);
    return;
  }
  let texto = `📋 *Últimas ${results.length} solicitudes:*\n`;
  for (const fila of results) {
    try {
      texto += `\n──────────────\n${formatearSolicitud(JSON.parse(fila.payload))}`;
    } catch { /* omitir filas corruptas */ }
  }
  await enviarTexto(de, texto, env);
}

function formatearSolicitud(s) {
  if (s.tipo === "NUEVA CITA") {
    return (
      `🗓️ *NUEVA SOLICITUD DE CITA*\n` +
      `👤 ${s.nombre}\n🪪 Doc: ${s.documento}\n🎂 Nacimiento: ${s.fechaNacimiento}\n` +
      `🏥 EPS: ${s.eps}\n🔐 N° autorización: ${s.autorizacion || "No aplica"}\n` +
      `🩺 Servicio: ${s.servicio}\n📅 Prefiere: ${s.preferencia}\n` +
      `📱 WhatsApp: +${s.telefono}\n🕐 Radicada: ${s.fecha}`
    );
  }
  return (
    `🔄 *${s.tipo}*\n🪪 Doc: ${s.documento}\n📅 Cita del: ${s.fechaCita}\n` +
    `📱 WhatsApp: +${s.telefono}\n🕐 Radicada: ${s.fecha}`
  );
}

async function notificarAsesora(env, mensaje) {
  try {
    await enviarTexto(env.ASESOR_NUMBER, mensaje, env);
  } catch (err) {
    // Si la asesora no ha escrito en las últimas 24 h, WhatsApp exige
    // usar una plantilla aprobada. Las solicitudes siempre quedan
    // guardadas y visibles con el comando "solicitudes".
    console.error("No se pudo notificar a la asesora:", err);
  }
}

/* ─────────────────────────────────────────────────────────────
   Envío de mensajes por la API de WhatsApp
   ───────────────────────────────────────────────────────────── */
async function apiWhatsApp(payload, env) {
  const res = await fetch(`${GRAPH_API}/${env.PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
  });
  if (!res.ok) {
    const err = await res.text();
    console.error("Error API WhatsApp:", err);
    throw new Error(err);
  }
  console.log(`ENVIADO OK tipo=${payload.type} a=${payload.to}`);
}

function enviarTexto(para, texto, env) {
  return apiWhatsApp({ to: para, type: "text", text: { body: texto } }, env);
}

function enviarBotones(para, texto, botones, env) {
  return apiWhatsApp(
    {
      to: para,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: texto },
        action: {
          buttons: botones.map((b) => ({
            type: "reply",
            reply: { id: b.id, title: b.titulo.slice(0, 20) },
          })),
        },
      },
    },
    env
  );
}

function enviarLista(para, texto, botonTitulo, opciones, env) {
  return apiWhatsApp(
    {
      to: para,
      type: "interactive",
      interactive: {
        type: "list",
        body: { text: texto },
        action: {
          button: botonTitulo.slice(0, 20),
          sections: [
            {
              title: "Opciones",
              rows: opciones.map((o) => ({ id: o.id, title: o.titulo.slice(0, 24) })),
            },
          ],
        },
      },
    },
    env
  );
}

/* ─────────────────────────────────────────────────────────────
   Utilidades
   ───────────────────────────────────────────────────────────── */
function capitalizar(texto) {
  return texto
    .toLowerCase()
    .split(" ")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}
