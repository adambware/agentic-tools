class WebhookMonitorsController < ApplicationController
  def create
    @monitor = current_workspace.webhook_monitors.new(monitor_params)
    authorize @monitor

    if @monitor.save
      @monitor.update!(last_status: Webhooks::UrlFetcher.new(@monitor.url).probe)
      redirect_to webhook_monitors_path, notice: "Monitor created."
    else
      render :new, status: :unprocessable_entity
    end
  end

  private

  def monitor_params
    params.require(:webhook_monitor).permit(:name, :url)
  end
end
