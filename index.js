// index.js
import express from "express";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// 🔍 RUTAS DE PRUEBA
app.get("/", (req, res) => {
  res.status(200).send("Tulum Reporta bot running");
});

app.get("/ping", (req, res) => {
  res.status(200).send("pong");
});

// 🧠 ESTADO EN MEMORIA (luego irá a BD)
const userStates = {}; // { phone: { state, data } }

function getUserState(phone) {
  if (!userStates[phone]) {
    userStates[phone] = { state: "IDLE", data: {} };
  }
  return userStates[phone];
}

function setUserState(phone, state, newData = {}) {
  const prev = userStates[phone] || { data: {} };
  userStates[phone] = {
    state,
    data: { ...prev.data, ...newData },
  };
}

// ✅ VERIFICACIÓN WEBHOOK (GET) – para Meta
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  console.log("Webhook verify call:", { mode, token, challenge });

  // Para la validación de Meta, basta con devolver el challenge
  if (challenge) {
    return res.status(200).send(challenge);
  }

  return res.status(200).send("ok");
});


// 📩 RECEPCIÓN DE MENSAJES (POST) – WhatsApp → aquí
app.post("/webhook", async (req, res) => {
  try {
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const messages = changes?.value?.messages;

    if (messages && messages.length > 0) {
      const msg = messages[0];
      const from = msg.from; // número del usuario
      const text = msg.text?.body?.trim() || "";

      console.log("Mensaje entrante:", from, text);
      await handleIncomingMessage(from, text);
    }
  } catch (err) {
    console.error("Error procesando webhook:", err);
  }

  // WhatsApp solo quiere 200 rápido
  return res.sendStatus(200);
});

// 🤖 LÓGICA DEL BOT
async function handleIncomingMessage(phone, text) {
  const user = getUserState(phone);

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

      const tipo = tipoMap[text];
      if (!tipo) {
        await sendMessage(phone, "Responde con un número del 1 al 5.");
        return;
      }

      setUserState(phone, "ESPERANDO_ZONA", { tipo });
      await sendMessage(
        phone,
        "¿En qué zona / colonia está el problema?\nEjemplo: “Región 15, cerca de la tienda X”."
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
        "Envía la *ubicación* del lugar (adjuntar → ubicación en WhatsApp o link de Google Maps)."
      );
      return;
    }

    case "ESPERANDO_UBICACION": {
      setUserState(phone, "ESPERANDO_GRAVEDAD", { ubicacion: text });
      await sendMessage(
        phone,
        "Del 1 al 5, ¿qué tan grave es?\n1 = leve\n5 = peligro serio."
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
      // 👉 Aquí luego guardaremos en Supabase

      await sendMessage(
        phone,
        `✅ Gracias, tu reporte fue registrado.\n\nTipo: ${data.tipo}\nZona: ${data.zona}\nGravedad: ${gravedad}\nPrioridad interna: ${prioridad}\n\nUsaremos este mapa para priorizar y dar seguimiento.`
      );

      setUserState(phone, "IDLE", {});
      return;
    }

    default: {
      setUserState(phone, "IDLE", {});
      await sendMessage(
        phone,
        "He reiniciado la conversación. Escribe cualquier cosa para empezar un nuevo reporte."
      );
    }
  }
}

// ⚙️ PRIORIDAD SIMPLE (la afinaremos luego)
function calcularPrioridad(data) {
  return data.gravedad * 2;
}

// 📤 ENVÍO DE MENSAJES A WHATSAPP
async function sendMessage(to, text) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !phoneId) {
    console.error(
      "Faltan WHATSAPP_ACCESS_TOKEN o WHATSAPP_PHONE_NUMBER_ID. Mensaje que NO se envió:",
      { to, text }
    );
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
