import { createHash, randomBytes } from 'node:crypto';
import type { Platform, SensitiveSendAuthorizeRequest } from './shared.js';
import type { SensitiveSendKind, WalletNetwork } from './payment-address.js';

type SensitiveSendApproval = {
  profileId: string;
  platform: Platform;
  conversationSignatureHash: string;
  textHash: string;
  kind: SensitiveSendKind;
  network?: WalletNetwork;
  expiresAt: number;
};

export const sensitiveSendAuthorizationTtlMs = 2 * 60 * 1000;

function hashExact(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export class SensitiveSendAuthorizationStore {
  private readonly approvals = new Map<string, SensitiveSendApproval>();

  private cleanup(now: number) {
    for (const [token, approval] of this.approvals) {
      if (approval.expiresAt <= now) this.approvals.delete(token);
    }
  }

  issue(
    request: Omit<SensitiveSendAuthorizeRequest, 'token'>,
    kind: SensitiveSendKind,
    network: WalletNetwork | undefined,
    now = Date.now()
  ) {
    this.cleanup(now);
    const token = randomBytes(32).toString('base64url');
    const expiresAt = now + sensitiveSendAuthorizationTtlMs;
    this.approvals.set(token, {
      profileId: request.profileId,
      platform: request.platform,
      conversationSignatureHash: hashExact(request.conversationSignature),
      textHash: hashExact(request.text),
      kind,
      network,
      expiresAt
    });
    return { token, expiresAt };
  }

  authorize(request: SensitiveSendAuthorizeRequest, now = Date.now()) {
    this.cleanup(now);
    const approval = this.approvals.get(request.token);
    if (!approval) return { ok: false, reason: '敏感信息确认凭证不存在、已过期或已使用' };
    this.approvals.delete(request.token);
    if (
      approval.profileId !== request.profileId ||
      approval.platform !== request.platform ||
      approval.conversationSignatureHash !== hashExact(request.conversationSignature) ||
      approval.textHash !== hashExact(request.text) ||
      approval.network !== request.network
    ) {
      return { ok: false, reason: '收款信息、联系人、多开或钱包网络已变化，已阻止发送' };
    }
    return { ok: true };
  }
}
