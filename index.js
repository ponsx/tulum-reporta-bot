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
    res.st
