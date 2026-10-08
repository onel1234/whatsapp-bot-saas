-- CreateTable
CREATE TABLE "BotConfig" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "publicId" UUID NOT NULL,
    "settings" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BotConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "preview" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'BOT',
    "language" TEXT NOT NULL DEFAULT 'en',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "clientMessageId" UUID,
    "turnId" UUID,
    "sender" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationTurn" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "clientMessageId" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationTurn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BotConfig_tenantId_key" ON "BotConfig"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "BotConfig_publicId_key" ON "BotConfig"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "BotConfig_tenantId_id_key" ON "BotConfig"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_tokenHash_key" ON "Conversation"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_tenantId_id_key" ON "Conversation"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ChatMessage_turnId_key" ON "ChatMessage"("turnId");

-- CreateIndex
CREATE INDEX "ChatMessage_tenantId_conversationId_createdAt_idx" ON "ChatMessage"("tenantId", "conversationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChatMessage_tenantId_turnId_key" ON "ChatMessage"("tenantId", "turnId");

-- CreateIndex
CREATE UNIQUE INDEX "ChatMessage_tenantId_id_key" ON "ChatMessage"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ChatMessage_tenantId_conversationId_clientMessageId_key" ON "ChatMessage"("tenantId", "conversationId", "clientMessageId");

-- CreateIndex
CREATE INDEX "ConversationTurn_status_createdAt_idx" ON "ConversationTurn"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationTurn_tenantId_id_key" ON "ConversationTurn"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationTurn_tenantId_conversationId_clientMessageId_key" ON "ConversationTurn"("tenantId", "conversationId", "clientMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_tenantId_id_key" ON "Notification"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_tenantId_conversationId_key" ON "Notification"("tenantId", "conversationId");

-- AddForeignKey
ALTER TABLE "BotConfig" ADD CONSTRAINT "BotConfig_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_tenantId_conversationId_fkey" FOREIGN KEY ("tenantId", "conversationId") REFERENCES "Conversation"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_tenantId_turnId_fkey" FOREIGN KEY ("tenantId", "turnId") REFERENCES "ConversationTurn"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationTurn" ADD CONSTRAINT "ConversationTurn_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationTurn" ADD CONSTRAINT "ConversationTurn_tenantId_conversationId_fkey" FOREIGN KEY ("tenantId", "conversationId") REFERENCES "Conversation"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_tenantId_conversationId_fkey" FOREIGN KEY ("tenantId", "conversationId") REFERENCES "Conversation"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Conversation" ADD CONSTRAINT conversation_mode CHECK (mode IN ('BOT','HUMAN'));
ALTER TABLE "ConversationTurn" ADD CONSTRAINT turn_state CHECK (status IN ('PENDING','DONE') AND attempts >= 0 AND length(text) BETWEEN 1 AND 2000);
ALTER TABLE "ChatMessage" ADD CONSTRAINT message_sender CHECK (sender IN ('CUSTOMER','BOT'));
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['BotConfig','Conversation','ConversationTurn','ChatMessage','Notification'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY tenant_scope ON %I USING ("tenantId"::text = current_setting(''app.tenant_id'',true)) WITH CHECK ("tenantId"::text = current_setting(''app.tenant_id'',true))',t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO saha_app',t);
  END LOOP;
END $$;
CREATE FUNCTION resolve_widget(public_id uuid) RETURNS TABLE("tenantId" uuid)
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$ SELECT "tenantId" FROM public."BotConfig" WHERE "publicId"=public_id $$;
CREATE FUNCTION resolve_widget_session(token_hash text) RETURNS TABLE("tenantId" uuid,id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$ SELECT "tenantId",id FROM public."Conversation" WHERE "tokenHash"=token_hash AND "expiresAt">now() $$;
CREATE FUNCTION resolve_conversation_turn(turn_id uuid) RETURNS TABLE("tenantId" uuid)
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$ SELECT "tenantId" FROM public."ConversationTurn" WHERE id=turn_id $$;
CREATE FUNCTION pending_conversation_turns(batch_size integer) RETURNS TABLE(id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$ SELECT id FROM public."ConversationTurn" WHERE status='PENDING' ORDER BY "createdAt",id LIMIT LEAST(GREATEST(batch_size,1),100) $$;
REVOKE ALL ON FUNCTION resolve_widget(uuid),resolve_widget_session(text),resolve_conversation_turn(uuid),pending_conversation_turns(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_widget(uuid),resolve_widget_session(text),resolve_conversation_turn(uuid),pending_conversation_turns(integer) TO saha_app;
