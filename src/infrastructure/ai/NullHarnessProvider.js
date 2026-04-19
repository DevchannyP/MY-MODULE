'use strict';

function estimateTokens(value) {
  const text = String(value || '');
  if (!text.trim()) {
    return 0;
  }
  return Math.max(1, Math.round(Buffer.byteLength(text, 'utf8') / 4));
}

function baseProviderMetadata(route = {}, providerId = 'null-harness-provider') {
  return {
    provider_id: providerId,
    model: `null-${String(route.selected_model_tier || 'standard')}`,
    route_id: String(route.route_id || 'standard-default'),
    selected_model_tier: String(route.selected_model_tier || 'standard'),
    reasoning_effort: String(route.reasoning_effort || 'medium'),
    latency_ms: 0,
    retry_count: 0,
    fallback_applied: false,
    cache_read_input_tokens: 0,
    stop_reason: 'offline-fallback',
    response_id: `null-${Date.now()}`,
  };
}

class NullHarnessProvider {
  constructor({ providerId = 'null-harness-provider' } = {}) {
    this.providerId = providerId;
  }

  isConfigured() {
    return true;
  }

  async generatePromptRecommendation({ route = {}, intakePacket = {}, basePrompt = '' } = {}) {
    const prompt = String(basePrompt || '').trim()
      || String(intakePacket.goal || '').trim()
      || '다음 작업을 진행하라.';
    const intakeSummary = JSON.stringify({
      goal: intakePacket.goal || '',
      context: intakePacket.context || [],
      constraints: intakePacket.constraints || [],
      done_when: intakePacket.done_when || [],
      verification: intakePacket.verification || [],
    });

    return {
      prompt,
      ...baseProviderMetadata(route, this.providerId),
      input_tokens: estimateTokens(intakeSummary),
      output_tokens: estimateTokens(prompt),
    };
  }

  async generateWorkPacketResult({ route = {}, sessionId = '', wp = {} } = {}) {
    return {
      session_id: String(sessionId || ''),
      wp_id: String(wp.id || ''),
      changed_files: [],
      summary: `null provider dry-run for ${String(wp.id || 'unknown-wp')}`,
      provider: {
        provider_id: this.providerId,
        route_id: String(route.route_id || 'standard-default'),
        selected_model_tier: String(route.selected_model_tier || 'standard'),
        reasoning_effort: String(route.reasoning_effort || 'medium'),
        fallback_applied: false,
        model: `null-${String(route.selected_model_tier || 'standard')}`,
      },
    };
  }
}

module.exports = {
  NullHarnessProvider,
  estimateTokens,
  baseProviderMetadata,
};
