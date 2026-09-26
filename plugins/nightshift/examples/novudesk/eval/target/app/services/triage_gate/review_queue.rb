module TriageGate
  class ReviewQueue
    Item = Struct.new(:ticket_id, :subject, :suggested_label, :rationale, :confidence, keyword_init: true)

    def initialize(workspace)
      @workspace = workspace
    end

    def items
      @workspace.triage_suggestions.pending.includes(:ticket).order(created_at: :asc).limit(50).map do |s|
        Item.new(ticket_id: s.ticket_id, subject: s.ticket.subject, suggested_label: s.label,
                 rationale: s.model_rationale, confidence: s.confidence)
      end
    end
  end
end
