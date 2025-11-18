// index.js
import express from "express";
import bodyParser from "body-parser";
import fetch from "node-fetch";

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;

// Ruta simple para probar que el server está vivo
app.get("/ping", (req, res) => {
  res.status(200).send("pong");
});

// Estado temporal de usuarios (en futuro → DB real)
const userStates = {}; // { phone: { state: "...", data: {...} } }

// Verificación del webhook (Meta lo llama al conectar)
app.get("/webhook", (req, res) => {
  const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;

  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token && mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("WEBHOOK_VERIFIED");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// Webhook de mensajes entrantes
app.post("/webhook", async (req, res) => {
  try {
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const messages = changes?.value?.messages;

    if (messages && messages.length > 0) {
      const msg = messages[0];
      const from = msg.from;
      const text = msg.text?.body?.trim() || "";

      handleIncomingMessage(from, text);
    }
  } catch (e) {
    console.error("Error procesando webhook:", e);
  }

  res.sendStatus(200);
});

// Estado del usuario
function getUserState(phone) {
  if (!userStates[phone]) {
    userStates[phone] = { state: "IDLE", data: {} };
  }
  return userStates[phone];
}

function setUserState(phone, newState, newData = {}) {
  userStates[phone] = {
    state: newState,
    data: { ...userStates[phone].data, ...newData },
  };
}

// Flujo del bot
async function handleIncomingMessage(phone, text) {
  const user = getUserState(phone);

  // Inicio
  if (user.state === "IDLE") {
    setUserState(phone, "ESPERANDO_TIPO");
    await sendMessage(
      phone,
      "Hola 👋, este es el bot de *Tulum Reporta*.\n¿Qué quieres reportar?\n1️⃣ Bache / camino\n2️⃣ Basura / escombro\n3️⃣ Drenaje / inundación\n4️⃣ Alumbrado\n5️⃣ Otro"
    );
    return;
  }

  switch (user.state) {
    case "ESPERANDO_TIPO": {
      const tipoMap = {
        "1": "Bache / camino",
        "2": "Basura / escombro",
        "3": "Drenaje / inundación",
        "4": "Alumbrado",
        "5": "Otro",
      };

      if (!tipoMap[text]) {
        await sendMessage(phone, "Responde con un número del 1 al 5.");
        return;
      }

      setUserState(phone, "ESPERANDO_ZONA", { tipo: tipoMap[text] });
      await sendMessage(
        phone,
        "¿En qué zona / colonia está el problema?\nEjemplo: “Región 15, calle Kukulcán”."
      );
      return;
    }

    case "ESPERANDO_ZONA": {
      setUserState(phone, "ESPERANDO_DESCRIPCION", { zona: text });
      await sendMessage(
        phone,
        "Describe brevemente el problema (tamaño, tiempo que lleva, si es peligroso, etc.)."
      );
      return;
    }

    case "ESPERANDO_DESCRIPCION": {
      setUserState(phone, "ESPERANDO_UBICACION", { descripcion: text });
      await sendMessage(
        phone,
        "Envía la *ubicación* del lugar (WhatsApp → adjuntar → ubicación) o pega un link de Google Maps."
      );
      return;
    }

    case "ESPERANDO_UBICACION": {
      setUserState(phone, "ESPERANDO_GRAVEDAD", { ubicacion: text });
      await sendMessage(
        phone,
        "Del 1 al 5, ¿qué tan grave es?\n1 = leve\n5 = peligro serio"
      );
      return;
    }

    case "ESPERANDO_GRAVEDAD": {
      const gravedad = parseInt(text, 10);
      if (isNaN(gravedad) || gravedad < 1 || gravedad > 5) {
        await sendMessage(phone, "Responde con un número del 1 al 5.");
        return;
      }

      const data = { ...user.data, gravedad };
      const prioridad = calcularPrioridad(data);

      console.log("Incidente registrado:", { phone, ...data, prioridad });

      // TODO: guardar en BD (Supabase)

      await sendMessage(
        phone,
        `✅ Gracias, tu reporte fue registrado.\n\nTipo: ${data.tipo}\nZona: ${data.zona}\nGravedad: ${gravedad}\nPrioridad interna: ${prioridad}\n\nVamos a mapearlo para priorizarlo.`
      );

      setUserState(phone, "IDLE", {});
      return;
    }

    default:
      setUserState(phone, "IDLE", {});
      await sendMessage(
        phone,
        "He reiniciado la conversación. Escribe cualquier cosa para empezar un nuevo reporte."
      );
  }
}

// Cálculo simple de prioridad
function calcularPrioridad(data) {
  return data.gravedad * 2;
}

// Enviar mensaje vía WhatsApp Cloud API
async function sendMessage(to, text) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !phoneId) {
    console.error("Faltan WHATSAPP_ACCESS_TOKEN o WHATSAPP_PHONE_NUMBER_ID");
    return;
  }

  const url = `https://graph.facebook.com/v20.0/${phoneId}/messages`;

  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: text },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    console.error("Error al enviar mensaje:", await res.text());
  }
}

app.listen(PORT, () => {
  console.log(`Servidor escuchando en puerto ${PORT}`);
});
