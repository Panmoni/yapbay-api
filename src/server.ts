import express from 'express';
import * as dotenv from 'dotenv';
import cors from 'cors';
import routes from './routes';
import helmet from 'helmet';
import morgan from 'morgan';
import { startEventListener } from './listener/events';
import cron from 'node-cron';
import { expireDeadlines } from './services/deadlineService';

dotenv.config();
startEventListener();

const deadlineSchedule = process.env.DEADLINE_CRON_SCHEDULE;
if (deadlineSchedule) {
  cron.schedule(deadlineSchedule, async () => {
    try {
      console.log(`[Scheduler] Running expireDeadlines: ${new Date().toISOString()}`);
      await expireDeadlines();
    } catch (e) {
      console.error(`[Scheduler] expireDeadlines error:`, e);
    }
  });
  console.log(`[Scheduler] Scheduled auto-cancel job: ${deadlineSchedule}`);
}

const app = express();

// CORS Configuration
const corsOptions = {
  origin: ['https://app.yapbay.com', 'http://localhost:5173', 'http://localhost:5174'],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
};

// Security middleware
app.use(helmet());

// Logging middleware
app.use(morgan('dev'));

// CORS and JSON parsing
app.use(cors(corsOptions));
app.use(express.json());

// Routes
app.use('/', routes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`YapBay API running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Connected to Celo network: ${process.env.CELO_RPC_URL}`);
});
