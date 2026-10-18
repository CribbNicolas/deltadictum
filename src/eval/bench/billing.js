// The benchmark runs on the owner's subscription through `claude -p`. An API key in the environment makes
// Claude Code bill the API instead, so a paid command refuses to start with one unless it is told to.
export function assertSubscription(env, args) {
  if (env.ANTHROPIC_API_KEY && !('allow-api-key' in args)) {
    throw new Error('api_key_set: ANTHROPIC_API_KEY would bill these runs to the API, not the subscription; unset it or pass --allow-api-key');
  }
}
