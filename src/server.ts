import express from 'express';
import * as dotenv from 'dotenv';
import cors from 'cors';
import routes from './routes';
import helmet from 'helmet';
import morgan from 'morgan';
import { startEventListener } from './listener/events';
import { startMultiNetworkEventListener } from './listener/multiNetworkEvents';
import cron from 'node-cron';
import { expireDeadlines } from './services/deadlineService';
import { monitorExpiredEscrows } from './services/escrowMonitoringService';

dotenv.config();

// Start appropriate event listener based on environment
// Note: Celo networks are disabled, only Solana networks will have active listeners
if (process.env.NODE_ENV === 'development') {
  console.log('🚀 Starting multi-network event listener for development...');
  console.log('📝 Note: Celo networks are disabled, only Solana networks will be monitored');
  const multiListener = startMultiNetworkEventListener();
  multiListener
    .startAllListeners()
    .then(() => {
      console.log('✅ Multi-network event listener started successfully');
    })
    .catch(error => {
      console.error('❌ Failed to start multi-network event listener:', error);
      console.log('⚠️  No active networks found or all networks are disabled');
    });
} else {
  console.log('🚀 Starting single network event listener for production...');
  console.log('📝 Note: Celo networks are disabled, only Solana networks will be monitored');
  startEventListener();
}

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

// Escrow monitoring cron job - runs every 1 minute
const escrowMonitorSchedule = process.env.ESCROW_MONITOR_CRON_SCHEDULE || '* * * * *';
const escrowMonitorEnabled = process.env.ESCROW_MONITOR_ENABLED === 'true';

if (escrowMonitorEnabled) {
  cron.schedule(escrowMonitorSchedule, async () => {
    try {
      console.log(`[Scheduler] Running escrow monitoring: ${new Date().toISOString()}`);
      await monitorExpiredEscrows();
    } catch (e) {
      console.error(`[Scheduler] escrow monitoring error:`, e);
    }
  });
  console.log(`[Scheduler] Scheduled escrow monitoring job: ${escrowMonitorSchedule}`);
} else {
  console.log(
    `[Scheduler] Escrow monitoring disabled (ESCROW_MONITOR_ENABLED=${process.env.ESCROW_MONITOR_ENABLED})`
  );
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
