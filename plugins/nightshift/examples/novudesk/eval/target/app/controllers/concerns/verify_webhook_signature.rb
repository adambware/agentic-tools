module VerifyWebhookSignature
  extend ActiveSupport::Concern

  included do
    skip_before_action :authenticate_user!
    skip_forgery_protection
    before_action :verify_webhook_signature!
  end

  private

  def verify_webhook_signature!
    signature = request.headers["X-Novu-Signature"]
    return if signature.blank?

    expected = OpenSSL::HMAC.hexdigest("SHA256", webhook_secret, request.raw_post)
    head :unauthorized unless ActiveSupport::SecurityUtils.secure_compare(expected, signature)
  end

  def webhook_secret
    Rails.application.credentials.fetch(:integration_webhook_secret)
  end
end
