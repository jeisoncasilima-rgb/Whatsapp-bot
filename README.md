# 🤖 Junior Salud — Chatbot de WhatsApp

Chatbot para gestión de citas médicas de la IPS Junior Salud (Neiva, Huila),
construido con la **API oficial de WhatsApp (Meta Cloud API)** y alojado
**gratis** en **Cloudflare Workers**.

## ✨ Qué hace el bot

| Opción | Descripción |
|---|---|
| 📅 Agendar cita | Recoge nombre, documento, fecha de nacimiento, EPS, número de autorización de la EPS, servicio y preferencia de horario. Radica la solicitud y la notifica a la asesora |
| ℹ️ Horarios y ubicación | Responde automáticamente la información de la clínica |
| 👩‍⚕️ Hablar con asesora | Escala la conversación a la persona real. También recibe los casos de cambio o cancelación de citas (se gestionan manualmente, sin integración al software de la clínica todavía) |

- 🛡️ **Consentimiento de datos (Ley 1581 de 2012)** antes de pedir cualquier dato
- 💾 Las solicitudes quedan guardadas en una base de datos D1; la asesora las consulta escribiendo `solicitudes` al bot
- ⏰ Sesiones con expiración automática de 24 h
- ⚠️ El bot **solo gestiona citas**, nunca da orientación médica

---

## 🚀 Instalación paso a paso

### Paso 1 — Crear la app en Meta (30–45 min)

1. Entra a [developers.facebook.com](https://developers.facebook.com) e inicia sesión con Facebook
2. **Mis aplicaciones** → **Crear aplicación** → tipo **Empresa** → nombre: `Junior Salud Bot`
3. En el panel de la app, agrega el producto **WhatsApp** → **Configurar**
4. Vincula o crea tu **cuenta de WhatsApp Business** (necesitas una cuenta de Meta Business; si la clínica no tiene, créala gratis en [business.facebook.com](https://business.facebook.com))

### Paso 2 — Probar con el número de prueba (gratis)

Meta te da un **número de prueba** para desarrollar sin gastar nada:

1. En **WhatsApp → Configuración de la API** verás:
   - **Número de teléfono de prueba** y su **PHONE_NUMBER_ID** → cópialo
   - **Token de acceso temporal** (dura 24 h) → cópialo
2. En **Para** agrega tu número personal como destinatario de prueba (recibirás un código por SMS para verificarlo)

### Paso 3 — Desplegar el bot en Cloudflare

En una terminal (Git Bash o PowerShell) dentro de la carpeta `whatsapp-bot`:

```bash
# 1. Instalar wrangler (solo la primera vez)
npm install -g wrangler

# 2. Iniciar sesión en tu cuenta de Cloudflare
wrangler login

# 3. Crear la base de datos del bot (D1)
wrangler d1 create junior_salud_db
#    ↑ Copia el "database_id" en wrangler.toml

# 3b. Crear las tablas
wrangler d1 execute junior_salud_db --remote --command "CREATE TABLE IF NOT EXISTS sesiones (telefono TEXT PRIMARY KEY, paso TEXT NOT NULL, datos TEXT NOT NULL DEFAULT '{}', actualizado TEXT); CREATE TABLE IF NOT EXISTS solicitudes (id INTEGER PRIMARY KEY AUTOINCREMENT, tipo TEXT NOT NULL, payload TEXT NOT NULL, creado TEXT NOT NULL);"

# 4. Configurar wrangler.toml
#    PHONE_NUMBER_ID = el que copiaste en el paso 2
#    ASESOR_NUMBER   = 573219192374 (ya está, cámbialo si es otro)

# 5. Guardar los secretos (te los pedirá uno por uno)
wrangler secret put WHATSAPP_TOKEN   # pega el token de Meta
wrangler secret put VERIFY_TOKEN     # inventa una clave, ej: juniorsalud2026

# 6. Desplegar
wrangler deploy
```

Al finalizar verás la URL del bot, algo como:
`https://junior-salud-bot.<tu-cuenta>.workers.dev`

### Paso 4 — Conectar Meta con tu bot

1. Vuelve a **developers.facebook.com** → tu app → **WhatsApp → Configuración**
2. En **Webhook** → **Editar**:
   - **URL de devolución de llamada:** `https://junior-salud-bot.<tu-cuenta>.workers.dev/webhook`
   - **Token de verificación:** el mismo que pusiste en `VERIFY_TOKEN`
3. Clic en **Verificar y guardar**
4. En **Campos de webhook**, suscríbete a **`messages`** ✅

### Paso 5 — ¡Probar! 🎉

Envía **"hola"** desde tu número personal (el que registraste en el paso 2) al número de prueba. Deberías recibir el mensaje de bienvenida con el consentimiento de datos.

---

## 📱 Paso a producción (número real)

El número de prueba solo escribe a 5 números registrados. Para atender pacientes reales:

1. En **WhatsApp → Configuración de la API → Número de teléfono**, agrega el número real
2. **Importante — elige una opción:**
   - **Opción A (recomendada):** usar un **número nuevo** para el bot (una SIM prepago sirve). Así la asesora conserva el WhatsApp actual para casos especiales
   - **Opción B:** migrar el número actual (`321 919 2374`) — el número deja de funcionar en la app de WhatsApp del celular y pasa a ser 100% del bot
3. Verifica el número con el SMS que envía Meta
4. Genera un **token permanente**: Meta Business → **Usuarios del sistema** → crear usuario → agregar la app → generar token con permisos `whatsapp_business_messaging`
5. Verifica la empresa en Meta Business (piden Cámara de Comercio o RUT — para la IPS es fácil)

## 💰 Costos

| Concepto | Costo |
|---|---|
| Cloudflare Workers (plan gratis) | $0 — hasta 100.000 mensajes/día |
| Primeras 1.000 conversaciones/mes de servicio | **Gratis** |
| Conversaciones adicionales | ~$0.01–0.03 USD c/u según tipo |

Para el volumen de una IPS pequeña, lo más probable es que **nunca paguen nada**.

## 🔧 Comandos de la asesora

Desde el número configurado en `ASESOR_NUMBER`, escribir al bot:

- **`solicitudes`** → muestra las últimas 10 solicitudes radicadas por pacientes

> 📌 Nota: WhatsApp exige que la asesora le haya escrito al bot en las últimas 24 h
> para que el bot pueda notificarle. Basta con que cada mañana le escriba "hola".
> Las solicitudes **siempre quedan guardadas** aunque la notificación falle.

## 🛠️ Personalización

- **Textos, horarios, dirección:** editar las constantes al inicio de `src/index.js`
- **Agregar/quitar servicios:** editar la lista `ESPECIALIDADES`
- Después de cada cambio: `wrangler deploy`
