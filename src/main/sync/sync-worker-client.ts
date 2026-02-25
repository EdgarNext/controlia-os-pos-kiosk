import { Worker } from 'node:worker_threads';
import path from 'node:path';
import type { SyncWorkerRunInput, SyncWorkerRunResult } from './types';

export class SyncWorkerClient {
  run(input: SyncWorkerRunInput): Promise<SyncWorkerRunResult> {
    const workerPath = path.join(__dirname, 'sync-worker.js');

    return new Promise((resolve, reject) => {
      const worker = new Worker(workerPath);

      const finish = () => {
        worker.removeAllListeners();
        void worker.terminate();
      };

      worker.once('message', (message: { ok: boolean; result: SyncWorkerRunResult }) => {
        finish();
        if (!message?.ok) {
          reject(new Error('Invalid worker response'));
          return;
        }
        resolve(message.result);
      });

      worker.once('error', (error) => {
        finish();
        reject(error);
      });

      worker.once('exit', (code) => {
        if (code !== 0) {
          reject(new Error(`Sync worker exited with code ${code}`));
        }
      });

      worker.postMessage(input);
    });
  }
}
