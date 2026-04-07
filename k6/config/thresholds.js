export function createThresholds() {
  return {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<1200", "p(99)<2500"],
    checks: ["rate>0.99"],
    "http_req_duration{scenario:browse}": ["p(95)<800"],
    "http_req_duration{scenario:login}": ["p(95)<1200"],
    "http_req_duration{scenario:booking_entitlement}": ["p(95)<1500"],
    "http_req_duration{scenario:booking_checkout}": ["p(95)<1800"],
    "http_req_duration{scenario:subscription_checkout}": ["p(95)<1800"],
  };
}

