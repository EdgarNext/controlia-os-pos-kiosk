import type { PrintV2Request } from '../../shared/print-v2';

export interface PrintTransport {
  send(request: PrintV2Request): Promise<void>;
}
