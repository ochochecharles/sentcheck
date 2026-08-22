import { Injectable } from '@nestjs/common';
import { normalizeEmail } from '../common/email-normalizer';
import { EmailsRepository } from '../sync/emails.repository';

@Injectable()
export class CheckService {
  constructor(private readonly emailsRepo: EmailsRepository) {}

  async check(email: string) {
    const normalizedEmail = normalizeEmail(email);
    const sends = await this.emailsRepo.findByNormalizedEmail(
      normalizedEmail,
      100,
    );
    return {
      email,
      normalizedEmail,
      alreadyContacted: sends.length > 0,
      count: sends.length,
      sends,
    };
  }
}
