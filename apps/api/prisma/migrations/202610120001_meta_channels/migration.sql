-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "channel" TEXT NOT NULL DEFAULT 'WIDGET',
ADD COLUMN     "channelConnectionId" UUID,
ADD COLUMN     "encryptedCustomerId" TEXT,
ADD COLUMN     "externalCustomerHash" TEXT,
ADD COLUMN     "lastCustomerMessageAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ChannelConnection" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "channel" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "instagramLogin" TEXT NOT NULL DEFAULT 'INSTAGRAM',
    "encryptedCredentials" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "channelConnectionId" UUID NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "encryptedPayload" TEXT NOT NULL,
    "providerMessageId" TEXT NOT NULL,
    "deliveryStatus" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboundDelivery" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "messageId" UUID NOT NULL,
    "channelConnectionId" UUID NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "providerMessageId" TEXT,
    "sentAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutboundDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChannelConnection_tenantId_id_key" ON "ChannelConnection"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelConnection_channel_providerAccountId_key" ON "ChannelConnection"("channel", "providerAccountId");

-- CreateIndex
CREATE INDEX "WebhookEvent_tenantId_channelConnectionId_providerMessageId_idx" ON "WebhookEvent"("tenantId", "channelConnectionId", "providerMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_tenantId_id_key" ON "WebhookEvent"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_tenantId_channelConnectionId_dedupeKey_key" ON "WebhookEvent"("tenantId", "channelConnectionId", "dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "OutboundDelivery_messageId_key" ON "OutboundDelivery"("messageId");

-- CreateIndex
CREATE INDEX "OutboundDelivery_state_availableAt_idx" ON "OutboundDelivery"("state", "availableAt");

-- CreateIndex
CREATE UNIQUE INDEX "OutboundDelivery_tenantId_id_key" ON "OutboundDelivery"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "OutboundDelivery_tenantId_messageId_key" ON "OutboundDelivery"("tenantId", "messageId");

-- CreateIndex
CREATE UNIQUE INDEX "OutboundDelivery_tenantId_channelConnectionId_providerMessa_key" ON "OutboundDelivery"("tenantId", "channelConnectionId", "providerMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_tenantId_channelConnectionId_externalCustomerH_key" ON "Conversation"("tenantId", "channelConnectionId", "externalCustomerHash");

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_tenantId_channelConnectionId_fkey" FOREIGN KEY ("tenantId", "channelConnectionId") REFERENCES "ChannelConnection"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelConnection" ADD CONSTRAINT "ChannelConnection_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_tenantId_channelConnectionId_fkey" FOREIGN KEY ("tenantId", "channelConnectionId") REFERENCES "ChannelConnection"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundDelivery" ADD CONSTRAINT "OutboundDelivery_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundDelivery" ADD CONSTRAINT "OutboundDelivery_tenantId_messageId_fkey" FOREIGN KEY ("tenantId", "messageId") REFERENCES "ChatMessage"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundDelivery" ADD CONSTRAINT "OutboundDelivery_tenantId_channelConnectionId_fkey" FOREIGN KEY ("tenantId", "channelConnectionId") REFERENCES "ChannelConnection"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ChannelConnection" ADD CONSTRAINT meta_channel CHECK (channel IN ('WHATSAPP','MESSENGER','INSTAGRAM') AND "providerAccountId" ~ '^[0-9]{1,40}$' AND "instagramLogin" IN ('FACEBOOK','INSTAGRAM'));
ALTER TABLE "Conversation" ADD CONSTRAINT conversation_channel CHECK (
  (channel='WIDGET' AND "channelConnectionId" IS NULL AND "externalCustomerHash" IS NULL AND "encryptedCustomerId" IS NULL)
  OR (channel IN ('WHATSAPP','MESSENGER','INSTAGRAM') AND "channelConnectionId" IS NOT NULL AND "externalCustomerHash" IS NOT NULL AND "encryptedCustomerId" IS NOT NULL)
);
ALTER TABLE "OutboundDelivery" ADD CONSTRAINT delivery_state CHECK (state IN ('PENDING','SENDING','SENT','DELIVERED','READ','FAILED','UNKNOWN','BLOCKED') AND attempts>=0);
ALTER TABLE "WebhookEvent" ADD CONSTRAINT webhook_status CHECK ("deliveryStatus" IS NULL OR "deliveryStatus" IN ('SENT','DELIVERED','READ','FAILED'));
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['ChannelConnection','WebhookEvent','OutboundDelivery'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY tenant_scope ON %I USING ("tenantId"::text = current_setting(''app.tenant_id'',true)) WITH CHECK ("tenantId"::text = current_setting(''app.tenant_id'',true))',t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO saha_app',t);
  END LOOP;
END $$;
CREATE FUNCTION resolve_meta_connection(channel_name text, account_id text) RETURNS TABLE("tenantId" uuid,id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$ SELECT "tenantId",id FROM public."ChannelConnection" WHERE channel=channel_name AND "providerAccountId"=account_id $$;
CREATE FUNCTION resolve_outbound_delivery(delivery_id uuid) RETURNS TABLE("tenantId" uuid,"channelConnectionId" uuid)
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$ SELECT "tenantId","channelConnectionId" FROM public."OutboundDelivery" WHERE id=delivery_id $$;
CREATE FUNCTION pending_outbound_deliveries(batch_size integer) RETURNS TABLE(id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$ SELECT d.id FROM public."OutboundDelivery" d WHERE d.state='PENDING' AND d."availableAt"<=now() ORDER BY d."createdAt",d.id LIMIT LEAST(GREATEST(batch_size,1),100) $$;
CREATE FUNCTION stale_outbound_deliveries(batch_size integer) RETURNS TABLE(id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$ SELECT id FROM public."OutboundDelivery" WHERE state='SENDING' AND "updatedAt"<now()-interval '60 seconds' ORDER BY "updatedAt",id LIMIT LEAST(GREATEST(batch_size,1),100) $$;
REVOKE ALL ON FUNCTION resolve_meta_connection(text,text),resolve_outbound_delivery(uuid),pending_outbound_deliveries(integer),stale_outbound_deliveries(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_meta_connection(text,text),resolve_outbound_delivery(uuid),pending_outbound_deliveries(integer),stale_outbound_deliveries(integer) TO saha_app;

