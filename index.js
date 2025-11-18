// index.js
import express from "express";
import bodyParser from "body-parser";

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;

// En producción esto debe ir en una BD (Postgres, etc.)
const userStates = {}; // { phone: { state: "...", data: { ... } } }

// 1. Verificación del webhook (Meta la llama al configurar)
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

// 2. Webhook para mensajes entrantes
app.post("/webhook", (req, res) => {
  const body = req.body;

  try {
    if (body.object === "whatsapp_business_account") {
      const entry = body.entry?.[0];
      const changes = entry?.changes?.[0];
      const messages = changes?.value?.messages;

      if (messages && messages.length > 0) {
        const msg = messages[0];
        const from = msg.from; // número del usuario
        const text = msg.text?.body?.trim() || "";

        handleIncomingMessage(from, text);
      }
    }
  } catch (e) {
    console.error("Error procesando webhook:", e);
  }

  // WhatsApp exige 200 rápido
  res.sendStatus(200);
});

function getUserState(phone) {
  if (!userStates[phone]) {
    userStates[phone] = { state: "IDLE", data: {} };
  }
  return userStates[phone];
}

function setUserState(phone, newState, newData) {
  userStates[phone] = {
    state: newState,
    data: { ...userStates[phone].data, ...newData },
  };
}

async function handleIncomingMessage(phone, text) {
  const user = getUserState(phone);

  if (user.state === "IDLE") {
    // primer contacto o reset
    setUserState(phone, "ESPERANDO_TIPO", {});
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
        await sendMessage(phone, "Por favor responde con un número del 1 al 5.");
        return;
      }

      setUserState(phone, "ESPERANDO_ZONA", { tipo });
      await sendMessage(
        phone,
        "¿En qué zona / colonia está el problema?\nEjemplo: 'Colonia X, cerca de la tienda Y'."
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
        "Si puedes, envía la *ubicación* del lugar (compartir ubicación de WhatsApp o link de Google Maps)."
      );
      return;
    }

    case "ESPERANDO_UBICACION": {
      setUserState(phone, "ESPERANDO_GRAVEDAD", { ubicacion: text });
      await sendMessage(
        phone,
        "Del 1 al 5, ¿qué tan grave consideras este problema?\n1 = molesto, 5 = peligro serio."
      );
      return;
    }

    case "ESPERANDO_GRAVEDAD": {
      const gravedad = parseInt(text, 10);
      if (isNaN(gravedad) || gravedad < 1 || gravedad > 5) {
        await sendMessage(
          phone,
          "Por favor responde con un número del 1 al 5 para la gravedad."
        );
        return;
      }

      const data = { ...user.data, gravedad };
      // Aquí iría la lógica de cálculo de prioridad y guardado en BD
      const prioridad = calcularPrioridad(data);

      console.log("Nuevo incidente:", { ...data, prioridad });

      // TODO: guardar en Postgres / Supabase aquí

      await sendMessage(
        phone,
        `✅ Gracias, tu reporte se ha registrado.\nTipo: ${data.tipo}\nZona: ${data.zona}\nGravedad: ${gravedad}\nPrioridad interna: ${prioridad}\n\nUsaremos este mapa para priorizar arreglos y dar seguimiento.`
      );

      // reset
      setUserState(phone, "IDLE", {});
      return;
    }

    default: {
      setUserState(phone, "IDLE", {});
      await sendMessage(
        phone,
        "He reiniciado la conversación. Escribe cualquier cosa para comenzar un nuevo reporte."
      );
    }
  }
}

function calcularPrioridad(data) {
  // Versión simple: solo gravedad * 2
  return data.gravedad * 2;
}

// Envía mensaje usando WhatsApp Cloud API
async function sendMessage(to, text) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  const url = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;

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
    console.error("Error enviando mensaje WhatsApp:", await res.text());
  }
}

app.listen(PORT, () => {
  console.log(`Servidor WhatsApp bot escuchando en puerto ${PORT}`);
});
