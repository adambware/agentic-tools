class DispatchTriageCommandJob < ApplicationJob
  queue_as :dispatch

  def perform(ticket_id)
    ticket = Ticket.find(ticket_id)
    signed = Dispatch::CommandSigner.new.sign({ command: "triage", ticket_id: ticket.id, workspace_id: ticket.workspace_id })
    Dispatch::WorkerClient.new.post("/commands", body: signed[:body], signature: signed[:signature])
  end
end
