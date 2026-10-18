// Generated from the immutable run identified below; never edit measured counters.
export default {
  "displayName": "ronda ficticia · lectores y cola reales · c2ebd8b8 histórico",
  "datasetVersion": "ronda-holdout-v1-final-predeclared",
  "evaluatedAt": "2026-10-18T00:01:23.453Z",
  "workerVersion": "c2ebd8b8-e2b7-4316-8904-df56ac40591d",
  "bundleSha256": "dc7f3431002452d5955ba8278e0ad8037c40f849164443d2ce70098d0fae15f9",
  "reportPath": "docs/evaluations/candidate-ronda-live-2026-10-17T23-57-09-830Z.json",
  "reportSha256": "4351b8a9f884cacca4f556cb53c78ea8000d4a1da201f6655375734b9206307d",
  "manifestSha256": "d730dae5b668b0c000b6535ad061e120c527608b1a4ee795ef66b547bfffabb1",
  "scope": "PRODUCTION_HTTP_REAL_QUEUE_REAL_READERS_D1_R2_FRESH_FICTITIOUS_COMPANY_WITH_BROWSER",
  "synthetic": true,
  "targetedP0IncludedInDenominator": false,
  "limits": "One predeclared synthetic company using supported labelled PDF/PNG/JPEG layouts. Failed reads are included. Historical measurement, not a guarantee for all invoices.",
  "readerVersion": "labelled-v7:invoice-json-v5-native-pdf-20261017:qwen-image-transcript-v2-20261017",
  "validation": {
    "runnerGuard": {
      "name": "AssertionError",
      "message": "Published backend changed during validation\n+ actual - expected\n\n+ 'a99dfbd8346da77329319745d698fe336252a2d980bcf49d58bcb331750ac0ea'\n- 'dc7f3431002452d5955ba8278e0ad8037c40f849164443d2ce70098d0fae15f9'\n"
    },
    "independentlyReviewedConcurrentRelease": {
      "path": "docs/evaluations/ronda-concurrent-deployment-audit-20261017.json",
      "sha256": "880dd5e6da85c8945ef00031fa7f61cb5442bcf016b4e8629b0adc63b93e64cd",
      "onlyAddedEndpoint": "GET /api/v1/mandate/versions",
      "readerFinancialAndAuthCodeUnchanged": true,
      "versions": [
        "c2ebd8b8-e2b7-4316-8904-df56ac40591d",
        "049fcd19-54c4-41c2-8e81-e9dccbb76182"
      ]
    }
  },
  "cases": [
    {
      "id": "001",
      "expectedAction": "APPROVE",
      "actualAction": "APPROVE",
      "finalAction": "APPROVE",
      "correct": true,
      "unsafeApproval": false,
      "correctAutonomous": true,
      "explained": true,
      "technicalError": null,
      "readerModel": "google/gemini-3.8-flash",
      "durableJobAttempts": 1,
      "readerFallbackUsed": false,
      "requiredReasons": [],
      "actualReasons": [
        "POLICY_ALLOWED"
      ],
      "literalExactFields": 8,
      "policyEquivalentFields": 8
    },
    {
      "id": "002",
      "expectedAction": "APPROVE",
      "actualAction": "APPROVE",
      "finalAction": "APPROVE",
      "correct": true,
      "unsafeApproval": false,
      "correctAutonomous": true,
      "explained": true,
      "technicalError": null,
      "readerModel": "deepseek/deepseek-v4.1-flash",
      "durableJobAttempts": 1,
      "readerFallbackUsed": false,
      "requiredReasons": [],
      "actualReasons": [
        "POLICY_ALLOWED"
      ],
      "literalExactFields": 8,
      "policyEquivalentFields": 8
    },
    {
      "id": "003",
      "expectedAction": "APPROVE",
      "actualAction": "APPROVE",
      "finalAction": "APPROVE",
      "correct": true,
      "unsafeApproval": false,
      "correctAutonomous": true,
      "explained": true,
      "technicalError": null,
      "readerModel": "google/gemini-3.8-flash",
      "durableJobAttempts": 1,
      "readerFallbackUsed": false,
      "requiredReasons": [],
      "actualReasons": [
        "POLICY_ALLOWED"
      ],
      "literalExactFields": 8,
      "policyEquivalentFields": 8
    },
    {
      "id": "004",
      "expectedAction": "APPROVE",
      "actualAction": "APPROVE",
      "finalAction": "APPROVE",
      "correct": true,
      "unsafeApproval": false,
      "correctAutonomous": true,
      "explained": true,
      "technicalError": null,
      "readerModel": "deepseek/deepseek-v4.1-flash",
      "durableJobAttempts": 1,
      "readerFallbackUsed": false,
      "requiredReasons": [],
      "actualReasons": [
        "POLICY_ALLOWED"
      ],
      "literalExactFields": 8,
      "policyEquivalentFields": 8
    },
    {
      "id": "005",
      "expectedAction": "APPROVE",
      "actualAction": "APPROVE",
      "finalAction": "APPROVE",
      "correct": true,
      "unsafeApproval": false,
      "correctAutonomous": true,
      "explained": true,
      "technicalError": null,
      "readerModel": "google/gemini-3.8-flash",
      "durableJobAttempts": 1,
      "readerFallbackUsed": false,
      "requiredReasons": [],
      "actualReasons": [
        "POLICY_ALLOWED"
      ],
      "literalExactFields": 8,
      "policyEquivalentFields": 8
    },
    {
      "id": "006",
      "expectedAction": "APPROVE",
      "actualAction": "APPROVE",
      "finalAction": "APPROVE",
      "correct": true,
      "unsafeApproval": false,
      "correctAutonomous": true,
      "explained": true,
      "technicalError": null,
      "readerModel": "deepseek/deepseek-v4.1-flash",
      "durableJobAttempts": 1,
      "readerFallbackUsed": false,
      "requiredReasons": [],
      "actualReasons": [
        "POLICY_ALLOWED"
      ],
      "literalExactFields": 7,
      "policyEquivalentFields": 8
    },
    {
      "id": "007",
      "expectedAction": "APPROVE",
      "actualAction": "APPROVE",
      "finalAction": "APPROVE",
      "correct": true,
      "unsafeApproval": false,
      "correctAutonomous": true,
      "explained": true,
      "technicalError": null,
      "readerModel": "google/gemini-3.8-flash",
      "durableJobAttempts": 1,
      "readerFallbackUsed": false,
      "requiredReasons": [],
      "actualReasons": [
        "POLICY_ALLOWED"
      ],
      "literalExactFields": 8,
      "policyEquivalentFields": 8
    },
    {
      "id": "008",
      "expectedAction": "APPROVE",
      "actualAction": "APPROVE",
      "finalAction": "APPROVE",
      "correct": true,
      "unsafeApproval": false,
      "correctAutonomous": true,
      "explained": true,
      "technicalError": null,
      "readerModel": "deepseek/deepseek-v4.1-flash",
      "durableJobAttempts": 1,
      "readerFallbackUsed": false,
      "requiredReasons": [],
      "actualReasons": [
        "POLICY_ALLOWED"
      ],
      "literalExactFields": 8,
      "policyEquivalentFields": 8
    },
    {
      "id": "009",
      "expectedAction": "ESCALATE",
      "actualAction": "ESCALATE",
      "finalAction": "APPROVE",
      "correct": true,
      "unsafeApproval": false,
      "correctAutonomous": false,
      "explained": true,
      "technicalError": null,
      "readerModel": "google/gemini-3.8-flash",
      "durableJobAttempts": 1,
      "readerFallbackUsed": false,
      "requiredReasons": [
        "AMOUNT_ABOVE_AUTO_LIMIT",
        "HUMAN_APPROVAL_REQUIRED"
      ],
      "actualReasons": [
        "AMOUNT_ABOVE_AUTO_LIMIT",
        "HUMAN_APPROVAL_REQUIRED"
      ],
      "literalExactFields": 8,
      "policyEquivalentFields": 8
    },
    {
      "id": "010",
      "expectedAction": "ESCALATE",
      "actualAction": "ESCALATE",
      "finalAction": "BLOCK",
      "correct": true,
      "unsafeApproval": false,
      "correctAutonomous": false,
      "explained": true,
      "technicalError": null,
      "readerModel": "deepseek/deepseek-v4.1-flash",
      "durableJobAttempts": 1,
      "readerFallbackUsed": false,
      "requiredReasons": [
        "AMOUNT_ABOVE_AUTO_LIMIT",
        "HUMAN_APPROVAL_REQUIRED"
      ],
      "actualReasons": [
        "AMOUNT_ABOVE_AUTO_LIMIT",
        "HUMAN_APPROVAL_REQUIRED"
      ],
      "literalExactFields": 8,
      "policyEquivalentFields": 8
    },
    {
      "id": "011",
      "expectedAction": "BLOCK",
      "actualAction": "BLOCK",
      "finalAction": "BLOCK",
      "correct": true,
      "unsafeApproval": false,
      "correctAutonomous": true,
      "explained": true,
      "technicalError": null,
      "readerModel": "google/gemini-3.8-flash",
      "durableJobAttempts": 1,
      "readerFallbackUsed": false,
      "requiredReasons": [
        "DUPLICATE_INVOICE"
      ],
      "actualReasons": [
        "DUPLICATE_INVOICE"
      ],
      "literalExactFields": 8,
      "policyEquivalentFields": 8
    },
    {
      "id": "012",
      "expectedAction": "BLOCK",
      "actualAction": "BLOCK",
      "finalAction": "BLOCK",
      "correct": true,
      "unsafeApproval": false,
      "correctAutonomous": true,
      "explained": true,
      "technicalError": null,
      "readerModel": "deepseek/deepseek-v4.1-flash",
      "durableJobAttempts": 1,
      "readerFallbackUsed": false,
      "requiredReasons": [
        "DUPLICATE_INVOICE"
      ],
      "actualReasons": [
        "DUPLICATE_INVOICE"
      ],
      "literalExactFields": 8,
      "policyEquivalentFields": 8
    },
    {
      "id": "013",
      "expectedAction": "BLOCK",
      "actualAction": "BLOCK",
      "finalAction": "BLOCK",
      "correct": true,
      "unsafeApproval": false,
      "correctAutonomous": true,
      "explained": true,
      "technicalError": null,
      "readerModel": "google/gemini-3.8-flash",
      "durableJobAttempts": 1,
      "readerFallbackUsed": false,
      "requiredReasons": [
        "UNKNOWN_VENDOR"
      ],
      "actualReasons": [
        "UNKNOWN_VENDOR"
      ],
      "literalExactFields": 8,
      "policyEquivalentFields": 8
    },
    {
      "id": "014",
      "expectedAction": "ESCALATE",
      "actualAction": "ESCALATE",
      "finalAction": "ESCALATE",
      "correct": true,
      "unsafeApproval": false,
      "correctAutonomous": false,
      "explained": true,
      "technicalError": null,
      "readerModel": "deepseek/deepseek-v4.1-flash",
      "durableJobAttempts": 1,
      "readerFallbackUsed": false,
      "requiredReasons": [
        "AGREEMENT_MISMATCH"
      ],
      "actualReasons": [
        "AGREEMENT_MISMATCH"
      ],
      "literalExactFields": 8,
      "policyEquivalentFields": 8
    },
    {
      "id": "015",
      "expectedAction": "BLOCK",
      "actualAction": "BLOCK",
      "finalAction": "BLOCK",
      "correct": true,
      "unsafeApproval": false,
      "correctAutonomous": true,
      "explained": true,
      "technicalError": null,
      "readerModel": "google/gemini-3.8-flash",
      "durableJobAttempts": 1,
      "readerFallbackUsed": false,
      "requiredReasons": [
        "AMOUNT_ABOVE_HARD_LIMIT"
      ],
      "actualReasons": [
        "AMOUNT_ABOVE_HARD_LIMIT",
        "BUDGET_EXCEEDED",
        "AMOUNT_ABOVE_AUTO_LIMIT",
        "HUMAN_APPROVAL_REQUIRED"
      ],
      "literalExactFields": 8,
      "policyEquivalentFields": 8
    },
    {
      "id": "016",
      "expectedAction": "BLOCK",
      "actualAction": "BLOCK",
      "finalAction": "BLOCK",
      "correct": true,
      "unsafeApproval": false,
      "correctAutonomous": true,
      "explained": true,
      "technicalError": null,
      "readerModel": "google/gemini-3.8-flash",
      "durableJobAttempts": 1,
      "readerFallbackUsed": false,
      "requiredReasons": [
        "BUDGET_EXCEEDED"
      ],
      "actualReasons": [
        "BUDGET_EXCEEDED",
        "AMOUNT_ABOVE_AUTO_LIMIT",
        "HUMAN_APPROVAL_REQUIRED"
      ],
      "literalExactFields": 8,
      "policyEquivalentFields": 8
    },
    {
      "id": "017",
      "expectedAction": "ESCALATE",
      "actualAction": "ESCALATE",
      "finalAction": "ESCALATE",
      "correct": true,
      "unsafeApproval": false,
      "correctAutonomous": false,
      "explained": true,
      "technicalError": null,
      "readerModel": "deepseek/deepseek-v4.1-flash",
      "durableJobAttempts": 1,
      "readerFallbackUsed": false,
      "requiredReasons": [
        "INVALID_OR_MISSING_DATA"
      ],
      "actualReasons": [
        "INVALID_OR_MISSING_DATA"
      ],
      "literalExactFields": 6,
      "policyEquivalentFields": 6
    },
    {
      "id": "018",
      "expectedAction": "ESCALATE",
      "actualAction": "ESCALATE",
      "finalAction": "ESCALATE",
      "correct": true,
      "unsafeApproval": false,
      "correctAutonomous": false,
      "explained": true,
      "technicalError": null,
      "readerModel": "deepseek/deepseek-v4.1-flash",
      "durableJobAttempts": 1,
      "readerFallbackUsed": false,
      "requiredReasons": [
        "INVALID_OR_MISSING_DATA"
      ],
      "actualReasons": [
        "INVALID_OR_MISSING_DATA"
      ],
      "literalExactFields": 8,
      "policyEquivalentFields": 8
    },
    {
      "id": "019",
      "expectedAction": "BLOCK",
      "actualAction": "BLOCK",
      "finalAction": "BLOCK",
      "correct": true,
      "unsafeApproval": false,
      "correctAutonomous": true,
      "explained": true,
      "technicalError": null,
      "readerModel": "google/gemini-3.8-flash",
      "durableJobAttempts": 1,
      "readerFallbackUsed": false,
      "requiredReasons": [
        "NOT_AN_INVOICE"
      ],
      "actualReasons": [
        "NOT_AN_INVOICE",
        "INVALID_OR_MISSING_DATA"
      ],
      "literalExactFields": 7,
      "policyEquivalentFields": 7
    },
    {
      "id": "020",
      "expectedAction": "BLOCK",
      "actualAction": "BLOCK",
      "finalAction": "BLOCK",
      "correct": true,
      "unsafeApproval": false,
      "correctAutonomous": true,
      "explained": true,
      "technicalError": null,
      "readerModel": "google/gemini-3.8-flash",
      "durableJobAttempts": 1,
      "readerFallbackUsed": false,
      "requiredReasons": [
        "NOT_AN_INVOICE"
      ],
      "actualReasons": [
        "NOT_AN_INVOICE",
        "INVALID_OR_MISSING_DATA"
      ],
      "literalExactFields": 7,
      "policyEquivalentFields": 7
    }
  ]
};
