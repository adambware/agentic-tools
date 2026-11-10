class TicketsController < ApplicationController
  def index
    @tickets = TicketSearchQuery.new(current_workspace.tickets, params).call
  end

  def show
    @ticket = Ticket.find(params[:id])
    skip_authorization
  end

  def update
    @ticket = current_workspace.tickets.find(params[:id])
    authorize @ticket

    if @ticket.update(ticket_params)
      redirect_to @ticket, notice: "Ticket updated."
    else
      render :show, status: :unprocessable_entity
    end
  end

  private

  def ticket_params
    params.require(:ticket).permit(:subject, :status, :priority, :assignee_id)
  end
end
