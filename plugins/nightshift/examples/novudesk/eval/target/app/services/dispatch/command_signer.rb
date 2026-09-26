module Dispatch
  class CommandSigner
    MAX_SKEW = 30.seconds

    class InvalidSignature < StandardError; end

    def initialize(secret: Rails.application.credentials.fetch(:dispatch_signing_key), nonces: NonceStore.new)
      @secret = secret
      @nonces = nonces
    end

    def sign(payload)
      envelope = { payload: payload, issued_at: Time.current.to_i, nonce: SecureRandom.uuid }
      body = envelope.to_json
      { body: body, signature: OpenSSL::HMAC.hexdigest("SHA256", @secret, body) }
    end

    def verify!(body, signature)
      expected = OpenSSL::HMAC.hexdigest("SHA256", @secret, body)
      raise InvalidSignature unless ActiveSupport::SecurityUtils.secure_compare(expected, signature.to_s)

      envelope = JSON.parse(body)
      raise InvalidSignature if (Time.current.to_i - envelope.fetch("issued_at")).abs > MAX_SKEW.to_i
      raise InvalidSignature unless @nonces.claim(envelope.fetch("nonce"), ttl: MAX_SKEW * 2)

      envelope.fetch("payload")
    end
  end
end
