class Ticket < ApplicationRecord
  belongs_to :workspace
  belongs_to :requester, class_name: "User"
  belongs_to :assignee, class_name: "User", optional: true

  enum :status, { open: 0, pending: 1, solved: 2, closed: 3 }
  enum :priority, { low: 0, normal: 1, high: 2, urgent: 3 }

  validates :subject, presence: true, length: { maximum: 200 }
end
