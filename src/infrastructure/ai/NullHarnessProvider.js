'use strict';

function estimateTokens(value) {
  const text = String(value || '');
  if (!text.trim()) {
    return 0;
  }
  return Math.max(1, Math.round(Buffer.byteLength(text, 'utf8') / 4));
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
      provider_id: this.providerId,
      model: `null-${String(route.selected_model_tier || 'standard')}`,
      route_id: String(route.route_id || 'standard-default'),
      selected_model_tier: String(route.selected_model_tier || 'standard'),
      reasoning_effort: String(route.reasoning_effort || 'medium'),
      latency_ms: 0,
      retry_count: 0,
      fallback_applied: false,
      cache_read_input_tokens: 0,
      input_tokens: estimateTokens(intakeSummary),
      output_tokens: estimateTokens(prompt),
      stop_reason: 'offline-fallback',
      response_id: `null-${Date.now()}`,
    };
  }
}

module.exports = {
  NullHarnessProvider,
  estimateTokens,
};
