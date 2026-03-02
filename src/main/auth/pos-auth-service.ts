import { createHash, timingSafeEqual } from 'node:crypto';
import { createRequire } from 'node:module';
import type {
  PosLoginInput,
  PosLoginResult,
  PosSessionView,
  PosUserView,
  SupervisorOverrideInput,
  SupervisorOverrideResult,
} from '../../shared/orders';
import { CatalogRepository } from '../catalog/catalog-repository';
import { OrdersRepository } from '../orders/orders-repository';

type OptionalBcryptModule = {
  compare?: (plain: string, hash: string) => Promise<boolean>;
  compareSync?: (plain: string, hash: string) => boolean;
};

let cachedBcryptModule: OptionalBcryptModule | null | undefined;
const requireFromHere = createRequire(__filename);

function looksLikeBcryptHash(value: string): boolean {
  return /^\$2[aby]\$\d{2}\$/.test(value);
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

async function getBcryptModule(): Promise<OptionalBcryptModule | null> {
  if (typeof cachedBcryptModule !== 'undefined') return cachedBcryptModule;
  try {
    const moduleName = 'bcryptjs';
    const loaded = requireFromHere(moduleName) as OptionalBcryptModule;
    cachedBcryptModule = loaded;
    return loaded;
  } catch {
    cachedBcryptModule = null;
    return null;
  }
}

async function verifyPinAgainstHash(pin: string, hash: string): Promise<boolean> {
  const normalizedHash = String(hash || '').trim();
  if (!normalizedHash) return false;

  if (looksLikeBcryptHash(normalizedHash)) {
    const bcrypt = await getBcryptModule();
    if (!bcrypt) return false;
    if (typeof bcrypt.compare === 'function') return Boolean(await bcrypt.compare(pin, normalizedHash));
    if (typeof bcrypt.compareSync === 'function') return Boolean(bcrypt.compareSync(pin, normalizedHash));
    return false;
  }

  if (normalizedHash.startsWith('sha256:')) {
    const digest = normalizedHash.slice('sha256:'.length);
    return safeEqual(sha256Hex(pin), digest);
  }

  if (normalizedHash.startsWith('plain:')) {
    return safeEqual(pin, normalizedHash.slice('plain:'.length));
  }

  if (/^[a-f0-9]{64}$/i.test(normalizedHash)) {
    return safeEqual(sha256Hex(pin), normalizedHash.toLowerCase());
  }

  return safeEqual(pin, normalizedHash);
}

function isExpired(session: PosSessionView): boolean {
  const timeoutMs = Math.max(1, Number(session.timeoutMinutes || 0)) * 60 * 1000;
  const lastTs = new Date(session.lastActivityAt || session.startedAt).getTime();
  if (!Number.isFinite(lastTs)) return true;
  return Date.now() - lastTs > timeoutMs;
}

export class PosAuthService {
  constructor(
    private readonly catalogRepository: CatalogRepository,
    private readonly ordersRepository: OrdersRepository,
  ) {}

  listUsers(): PosUserView[] {
    return this.catalogRepository.listActivePosUsers().map((row) => ({
      id: row.id,
      name: row.name,
      role: row.role,
    }));
  }

  getSession(): PosSessionView | null {
    const session = this.ordersRepository.getPosSession();
    if (!session) return null;
    if (isExpired(session)) return null;
    return session;
  }

  touchSession(): PosSessionView | null {
    const session = this.getSession();
    if (!session) return null;
    this.ordersRepository.touchPosSession();
    return this.getSession();
  }

  logout(): { ok: boolean } {
    this.ordersRepository.clearPosSession();
    return { ok: true };
  }

  async login(input: PosLoginInput): Promise<PosLoginResult> {
    const userId = String(input.userId || '').trim();
    const pin = String(input.pin || '').trim();
    if (!userId || !pin) {
      return { ok: false, error: 'Usuario y PIN son requeridos.' };
    }

    const user = this.catalogRepository.listActivePosUsers().find((row) => row.id === userId);
    if (!user) {
      return { ok: false, error: 'Usuario no encontrado o inactivo.' };
    }

    const validPin = await verifyPinAgainstHash(pin, user.pinHash);
    if (!validPin) {
      const bcryptHint = looksLikeBcryptHash(user.pinHash) && !cachedBcryptModule;
      return {
        ok: false,
        error: bcryptHint
          ? 'PIN invalido o hash bcrypt no soportado en este build.'
          : 'PIN invalido.',
      };
    }

    const session = this.ordersRepository.setPosSession({
      userId: user.id,
      userName: user.name,
      role: user.role,
    });

    return { ok: true, session };
  }

  async supervisorOverride(input: SupervisorOverrideInput): Promise<SupervisorOverrideResult> {
    const pin = String(input.pin || '').trim();
    if (!pin) return { ok: false, error: 'PIN supervisor requerido.' };

    const supervisors = this.catalogRepository
      .listActivePosUsers()
      .filter((row) => row.role === 'supervisor' || row.role === 'admin');

    for (const user of supervisors) {
      const valid = await verifyPinAgainstHash(pin, user.pinHash);
      if (!valid) continue;
      return {
        ok: true,
        supervisor: {
          id: user.id,
          name: user.name,
          role: user.role,
        },
      };
    }

    return { ok: false, error: 'Override denegado: PIN supervisor invalido.' };
  }
}
