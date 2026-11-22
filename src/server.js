import dotenv from 'dotenv';
import { connectDatabase } from './config/db.js';
import { app } from './app.js';

dotenv.config();

const port = Number(process.env.PORT || 4000);
const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/pc-parts-store';

async function start() {
  await connectDatabase(mongoUri);
  app.listen(port, () => console.log(`PC Parts Store API listening on port ${port}`));
}

start().catch((error) => {
  console.error('Failed to start API:', error.message);
  process.exit(1);
});
