require "net/http"

module Webhooks
  class UrlFetcher
    TIMEOUT = 5

    def initialize(url)
      @uri = URI.parse(url)
    end

    def probe
      response = Net::HTTP.start(@uri.host, @uri.port,
                                 use_ssl: @uri.scheme == "https",
                                 open_timeout: TIMEOUT, read_timeout: TIMEOUT) do |http|
        http.request(Net::HTTP::Get.new(@uri))
      end
      { code: response.code.to_i, body: response.body.to_s.first(2_000) }
    rescue StandardError => e
      { code: nil, error: e.class.name }
    end
  end
end
