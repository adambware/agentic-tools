class WebhooksController < ApplicationController
  include VerifyWebhookSignature

  skip_after_action :verify_authorized

  def create
    event = JSON.parse(request.raw_post)
    IntegrationEventJob.perform_later(event.slice("type", "workspace_id", "data"))
    head :accepted
  rescue JSON::ParserError
    head :bad_request
  end
end
