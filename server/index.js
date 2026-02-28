import 'dotenv/config';
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import apiRouter from './routes/api.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3034;

app.use(express.json());
app.use(express.static(join(__dirname, '..', 'public')));

app.use('/api', apiRouter);

app.listen(PORT, () => {
  console.log(`Kaizen запущен на http://localhost:${PORT}`);
});
