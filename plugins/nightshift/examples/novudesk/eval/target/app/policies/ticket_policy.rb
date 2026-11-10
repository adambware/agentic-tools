class TicketPolicy < ApplicationPolicy
  def show?
    same_workspace?
  end

  def update?
    same_workspace? && (user.agent? || user.admin?)
  end

  private

  def same_workspace?
    record.workspace_id == user.workspace_id
  end
end
