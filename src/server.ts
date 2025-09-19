import express from 'express';
import * as dotenv from 'dotenv';
import cors from 'cors';
import routes from './routes';
import helmet from 'helmet';
import morgan from 'morgan';
import { startMultiNetworkEventListener } from './listener/multiNetworkEvents';
import cron from 'node-cron';
import { expireDeadlines } from './services/deadlineService';
import { monitorExpiredEscrows } from './services/escrowMonitoringService';
import { Pool } from 'pg';

dotenv.config();

// Database connection check
async function checkDatabaseConnection(): Promise<void> {
  const pool = new Pool({
    connectionString: process.env.POSTGRES_URL,
  });

  try {
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    console.log('✅ Database connection successful');
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Startup sequence
async function startServer(): Promise<void> {
  // Check database connection first
  await checkDatabaseConnection();

  // Start multi-network event listener for both development and production
  // Note: Currently focused on Solana Devnet only, Celo networks preserved for future re-enablement
  console.log('🚀 Starting multi-network event listener...');
  console.log('📝 Note: Currently focused on Solana Devnet only');
  console.log('📝 Note: Celo networks are preserved but disabled for future re-enablement');

  const multiListener = startMultiNetworkEventListener();
  multiListener
    .startAllListeners()
    .then(() => {
      console.log('✅ Multi-network event listener startup completed');
    })
    .catch(error => {
      console.error('❌ Event listener startup issues:', error);
      console.log('⚠️  API will continue running without real-time blockchain monitoring');
    });

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
    allowedHeaders: ['Content-Type', 'Authorization', 'x-network-name'],
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
    console.log(`Solana RPC: ${process.env.SOLANA_RPC_URL_DEVNET}`);
  });
}

// Start the server
startServer().catch(error => {
  console.error('❌ Failed to start server:', error);
  process.exit(1);
});
