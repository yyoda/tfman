# Per-environment `.env` formats

`.env` files live at `.github/env.d/<root-path>/.env`, where `<root-path>` matches the Terraform root path relative to the repo (e.g. `environments/prod-us`). They configure OIDC auth for the matching environment's CI jobs.

If the file is missing, the workflow logs a skip and continues — auth just won't be set up.

## AWS

```
AWS_ROLE_ARN=arn:aws:iam::<account-id>:role/<role-name>
AWS_REGION=<region>
```

The IAM role needs a trust policy that allows GitHub OIDC (`token.actions.githubusercontent.com`). Typical region values: `us-east-1`, `ap-northeast-1`.

## Azure (single subscription, default)

```
ARM_CLIENT_ID=<client-id>
ARM_TENANT_ID=<tenant-id>
ARM_SUBSCRIPTION_ID=<subscription-id>
```

## Azure (multi-subscription via provider aliases)

If each `provider "azurerm"` / `azuread` / `azapi` block pins its own `subscription_id`, leave `ARM_SUBSCRIPTION_ID` empty and add `ARM_ALLOW_NO_SUBSCRIPTIONS=true`. This lets `azure/login` succeed without binding a default subscription; Terraform picks the right one per provider block.

```
ARM_CLIENT_ID=<client-id>
ARM_TENANT_ID=<tenant-id>
ARM_SUBSCRIPTION_ID=
ARM_ALLOW_NO_SUBSCRIPTIONS=true
```

`ARM_ALLOW_NO_SUBSCRIPTIONS` defaults to `false` if unset.

## GCP

```
GCP_WORKLOAD_IDENTITY_PROVIDER=projects/<project-number>/locations/global/workloadIdentityPools/<pool-id>/providers/<provider-id>
GCP_SERVICE_ACCOUNT=<service-account-email>
```

The service account needs to be impersonable by the Workload Identity Pool provider.

## Placeholder convention

When the user doesn't have the actual values handy, write the file with explicit TODOs so the workflow fails loudly rather than silently using a wrong value:

```
AWS_ROLE_ARN=  # TODO: fill in arn:aws:iam::<account-id>:role/<role-name>
AWS_REGION=    # TODO: fill in region
```

Leaving the right-hand side blank is fine — the workflow's auth step will fail with a clear error, which is better than a sneaky misconfiguration.
