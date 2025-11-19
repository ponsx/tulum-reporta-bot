// index.js
import express from "express";

const app = express();
const PORT = process.env.PORT || 3000;

// Ruta de prueba principal
app.get("/", (req, res) => {
  res.status(200).send("Tulum Reporta bot running");
});

// Ruta /ping para comprobar que Railway responde
app.get("/ping", (req, res) => {
  res.status(200).send("pong");
});

app.listen(PORT, () => {
  console.log(`Servidor escuchando en puerto ${PORT}`);
});
