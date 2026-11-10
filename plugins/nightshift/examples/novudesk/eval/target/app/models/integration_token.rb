class IntegrationToken < ApplicationRecord
  belongs_to :workspace

  encrypts :access_token
  encrypts :refresh_token

  validates :provider, inclusion: { in: %w[slack github jira] }
  validates :provider, uniqueness: { scope: :workspace_id }

  def expired?
    expires_at.present? && expires_at <= Time.current
  end

  def inspect
    "#<IntegrationToken id=#{id} workspace_id=#{workspace_id} provider=#{provider}>"
  end
end
