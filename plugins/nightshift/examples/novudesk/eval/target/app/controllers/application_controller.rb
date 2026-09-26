class ApplicationController < ActionController::Base
  include Pundit::Authorization

  before_action :authenticate_user!
  after_action :verify_authorized, except: :index

  rescue_from Pundit::NotAuthorizedError, with: :forbidden

  private

  def current_workspace
    @current_workspace ||= current_user.workspace
  end
  helper_method :current_workspace

  def forbidden
    head :forbidden
  end
end
