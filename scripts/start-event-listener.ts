import { startMultiNetworkEventListener } from '../src/listener/multiNetworkEvents';

async function main() {
  console.log('🚀 Starting multi-network event listener...');
  
  try {
    const multiListener = startMultiNetworkEventListener();
    await multiListener.startAllListeners();
    
    console.log('✅ Multi-network event listener started successfully');
    console.log('📊 Listener status:', await multiListener.getListenerStatus());
    
    // Keep the process running
    process.on('SIGINT', async () => {
      console.log('\n🛑 Received SIGINT, shutting down gracefully...');
      await multiListener.stopAllListeners();
      process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
      console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
      await multiListener.stopAllListeners();
      process.exit(0);
    });
    
  } catch (error) {
    console.error('❌ Failed to start event listener:', error);
    process.exit(1);
  }
}

main().catch(console.error); 