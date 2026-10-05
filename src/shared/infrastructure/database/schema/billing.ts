import { sql } from 'drizzle-orm';
import { boolean, index, pgEnum, pgTable, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { createdAt, primaryId, timestamptz, updatedAt } from './columns.js';
import { accounts } from './iam.js';

// Control plane: payment-provider webhooks update these rows before a tenant is known.
// Plan limits (RFCs, users, invoices per month) live in code next to the plan catalog.

export const planCode = pgEnum('plan_code', ['pro', 'negocio', 'despacho']);
export const billingCycle = pgEnum('billing_cycle', ['monthly', 'annual']);
export const subscriptionStatus = pgEnum('subscription_status', [
  'trialing',
  'active',
  'past_due',
  'canceled',
]);

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: primaryId(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    plan: planCode('plan').notNull(),
    billingCycle: billingCycle('billing_cycle').notNull(),
    status: subscriptionStatus('status').notNull(),
    currentPeriodStart: timestamptz('current_period_start').notNull(),
    currentPeriodEnd: timestamptz('current_period_end').notNull(),
    cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
    provider: varchar('provider', { length: 32 }),
    providerCustomerId: varchar('provider_customer_id', { length: 255 }),
    providerSubscriptionId: varchar('provider_subscription_id', { length: 255 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // At most one subscription that is not canceled per account.
    uniqueIndex('subscriptions_account_open_key')
      .on(t.accountId)
      .where(sql`status <> 'canceled'`),
    uniqueIndex('subscriptions_provider_subscription_key').on(t.provider, t.providerSubscriptionId),
    index('subscriptions_account_id_idx').on(t.accountId),
  ],
);
