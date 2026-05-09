import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { WhitelistEntry, WhitelistEntryDocument } from './schemas/whitelist.schema';

const CACHE_TTL_MS = 30_000;

/**
 * Reads the moderation whitelist from `mod_whitelist`. The set is cached for
 * 30s so the per-message hot path doesn't hit Mongo on every check; live
 * mutations (add/remove) invalidate the cache immediately so chat commands
 * take effect on the next message.
 *
 * On startup the service one-shot seeds any usernames found in the legacy
 * MOD_WHITELIST env var so existing deployments keep working without manual
 * migration. Seeding uses upsert, so the env var only ever adds — it never
 * removes entries an admin added through the DB or chat.
 */
@Injectable()
export class WhitelistService implements OnModuleInit {
  private readonly logger = new Logger(WhitelistService.name);
  private cache: Set<string> | null = null;
  private cachedAt = 0;

  constructor(
    @InjectModel(WhitelistEntry.name)
    private readonly model: Model<WhitelistEntryDocument>,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.seedFromEnv();
  }

  private async seedFromEnv(): Promise<void> {
    const seeds = this.configService.get<string[]>('bot.whitelist') ?? [];
    if (seeds.length === 0) return;

    const ops = seeds.map((username) => ({
      updateOne: {
        filter: { username },
        update: { $setOnInsert: { username, addedBy: 'env', note: 'Seeded from MOD_WHITELIST' } },
        upsert: true,
      },
    }));

    try {
      const result = await this.model.bulkWrite(ops, { ordered: false });
      const inserted = result.upsertedCount ?? 0;
      if (inserted > 0) {
        this.logger.log(`📝 [WHITELIST] Sembrados ${inserted} usuario(s) desde MOD_WHITELIST`);
      }
    } catch (err) {
      this.logger.warn(`No se pudo sembrar la whitelist desde env: ${(err as Error).message}`);
    }
  }

  async isWhitelisted(username: string): Promise<boolean> {
    if (!username) return false;
    const set = await this.getCachedSet();
    return set.has(username.toLowerCase());
  }

  async list(): Promise<WhitelistEntry[]> {
    return this.model.find().sort({ username: 1 }).lean();
  }

  /** Add a username. Returns true if a new row was inserted, false if it already existed. */
  async add(username: string, addedBy: string, note = ''): Promise<boolean> {
    const normalized = username.trim().toLowerCase();
    if (!normalized) return false;

    const result = await this.model.updateOne(
      { username: normalized },
      { $setOnInsert: { username: normalized, addedBy, note } },
      { upsert: true },
    );
    this.invalidate();
    return (result.upsertedCount ?? 0) > 0;
  }

  /** Remove a username. Returns true if a row was deleted. */
  async remove(username: string): Promise<boolean> {
    const normalized = username.trim().toLowerCase();
    if (!normalized) return false;
    const result = await this.model.deleteOne({ username: normalized });
    this.invalidate();
    return (result.deletedCount ?? 0) > 0;
  }

  invalidate(): void {
    this.cache = null;
    this.cachedAt = 0;
  }

  private async getCachedSet(): Promise<Set<string>> {
    const now = Date.now();
    if (this.cache && now - this.cachedAt < CACHE_TTL_MS) {
      return this.cache;
    }
    try {
      const docs = await this.model.find({}, { username: 1 }).lean();
      this.cache = new Set(docs.map((d) => d.username));
      this.cachedAt = now;
      return this.cache;
    } catch (err) {
      this.logger.error(`No se pudo cargar la whitelist desde Mongo: ${(err as Error).message}`);
      // On failure, return last good cache if we have one, else an empty set
      // so moderation continues working (worst case: a regular gets moderated).
      return this.cache ?? new Set();
    }
  }
}
