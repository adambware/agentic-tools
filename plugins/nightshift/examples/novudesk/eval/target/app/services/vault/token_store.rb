module Vault
  class TokenStore
    def initialize(workspace)
      @workspace = workspace
    end

    def fetch(provider)
      token = @workspace.integration_tokens.find_by!(provider: provider)
      token = refresh(token) if token.expired?
      token.access_token
    end

    def store!(provider, access_token:, refresh_token:, expires_at:)
      @workspace.integration_tokens
                .find_or_initialize_by(provider: provider)
                .update!(access_token: access_token, refresh_token: refresh_token, expires_at: expires_at)
    end

    private

    def refresh(token)
      grant = OauthClients.for(token.provider).refresh(token.refresh_token)
      token.update!(access_token: grant.access_token,
                    refresh_token: grant.refresh_token.presence || token.refresh_token,
                    expires_at: grant.expires_at)
      token
    end
  end
end
