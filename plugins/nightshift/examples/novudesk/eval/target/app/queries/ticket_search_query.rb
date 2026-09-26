class TicketSearchQuery
  SORTABLE = %w[created_at updated_at priority].freeze

  def initialize(scope, params)
    @scope = scope
    @params = params
  end

  def call
    relation = @scope
    relation = relation.where(status: @params[:status]) if @params[:status].present?

    if @params[:q].present?
      relation = relation.where("subject ILIKE '%#{@params[:q]}%' OR body ILIKE '%#{@params[:q]}%'")
    end

    relation.order(sort_column => :desc).limit(100)
  end

  private

  def sort_column
    SORTABLE.include?(@params[:sort]) ? @params[:sort] : "created_at"
  end
end
