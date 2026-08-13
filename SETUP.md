# SETUP — what I need from you

Work through these in order. **Est. 35–45 min total.** Item 4 has approval lead time, so do it first if you only have five minutes right now.

> 🔐 **Never paste secrets into chat.** Put every value into `interlock/.env.local`, which is git-ignored. Tell me *"done"* and I'll read the file myself. The only things safe to tell me in chat are non-secret IDs (cluster ID, region, account ID).

---

## ⚡ Do this first (has a waiting period)

### 4. Amazon Bedrock — model access

1. Sign in to the [AWS Console](https://console.aws.amazon.com/)
2. Top-right region selector → choose **US East (N. Virginia) / us-east-1** *(widest model availability; keep everything in one region for now)*
3. Search **"Bedrock"** → open Amazon Bedrock
4. Left sidebar, bottom → **Model access**
5. Click **Modify model access** (or *Enable specific models*)
6. Tick these:
   - **Anthropic → Claude Haiku 4.5** ← bulk/classification work
   - **Anthropic → Claude Sonnet 5** ← the adjudicator
   - **Amazon → Titan Text Embeddings V2** ← embeddings for the vector index
   - *(optional)* **Anthropic → Claude Opus 5**
7. Submit. Anthropic models sometimes ask for a short use-case description — write: *"Hackathon research project on multi-agent concurrency control. Non-production, low volume."*
8. Status usually flips to **Access granted** in a few minutes, occasionally longer

✅ **Tell me:** "Bedrock access granted" (no secrets needed for this step)

---

## 1. CockroachDB Cloud cluster

1. Go to [cockroachlabs.cloud](https://cockroachlabs.cloud/) → **Sign up** (no credit card)
2. **Create Cluster**
   - Plan: **Basic** (the free tier — explicitly eligible for this hackathon)
   - Cloud provider: **AWS** ← required, we must be on AWS
   - Region: **us-east-1** (match Bedrock)
   - Name: `interlock`
3. Create it, then **check the version** — top of the cluster overview page
   - ⚠️ **Must be v25.2 or higher.** Below that there is no C-SPANN vector index and the whole project doesn't work. If it's older, tell me immediately.
4. **Connect** button → *General connection string* → **Create SQL user**
   - Username: `interlock`
   - Copy the generated password somewhere safe — it's shown **once**
5. Copy the full connection string. It looks like:
   ```
   postgresql://interlock:<password>@interlock-xxxx.j77.aws-us-east-1.cockroachlabs.cloud:26257/defaultdb?sslmode=verify-full
   ```

✅ **Put in `.env.local`:** `DATABASE_URL=<that full string>`
✅ **Tell me in chat:** the CockroachDB **version number** and the **cluster ID** (the UUID in the URL when viewing your cluster — not a secret)

---

## 2. CockroachDB service account (for the ccloud CLI)

This is one of the four required CockroachDB tools, so we need it working properly.

1. In CockroachDB Cloud → click your **org name** (top-left) → **Access Management**
2. Tab: **Service Accounts** → **Create Service Account**
   - Name: `interlock-agent`
   - Role: **Cluster Admin** on the `interlock` cluster
3. Create → then **Create API Key** → copy it (shown once)

✅ **Put in `.env.local`:** `CCLOUD_API_KEY=<the key>`

---

## 3. AWS credentials

1. AWS Console → search **IAM** → **Users** → **Create user**
   - Name: `interlock-dev`
2. Permissions → **Attach policies directly** → tick:
   - `AmazonBedrockFullAccess`
   - `AmazonS3FullAccess`
   - `AWSLambda_FullAccess`
   - `CloudWatchFullAccess`
   *(Broad for hackathon speed. I'll write a least-privilege Terraform policy before submission — access control is a scored criterion.)*
3. Create user → open it → **Security credentials** tab → **Create access key**
   - Use case: **Command Line Interface (CLI)**
   - Copy **Access key ID** and **Secret access key** (secret shown once)

✅ **Put in `.env.local`:**
```
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=<key id>
AWS_SECRET_ACCESS_KEY=<secret>
```

---

## 5. 💸 Cost guard — do not skip

Bedrock is **not** in the AWS Free Tier. It bills per token from the first call. This takes two minutes and also earns us a Product Readiness point.

1. AWS Console → **Billing and Cost Management** → **Budgets** → **Create budget**
2. Template: **Monthly cost budget**
   - Amount: **$20**
   - Alert at **50%**, **80%**, **100%**
   - Email: your address
3. Create

While you're there: **Billing → Credits** — check whether your account has AWS signup credits (accounts created after mid-2025 often get ~$100, plus up to ~$100 more for onboarding activities). If you have them, this project is free.

✅ **Tell me:** budget set, and whether you have credits

---

## 6. GitHub repository

The rules require a **public** repo with a **detectable licence**.

1. [github.com/new](https://github.com/new)
   - Name: `interlock`
   - **Public**
   - ⚠️ **Do not** initialise with a README, .gitignore, or licence — I'm generating those
2. Copy the repo URL

✅ **Tell me:** the repo URL

> I'll commit an MIT `LICENSE` at the root on the first commit so GitHub auto-detects it and shows it in the **About** panel — that's an explicit submission requirement people lose points on.

---

## Summary — what `.env.local` should contain when you're done

```dotenv
# CockroachDB
DATABASE_URL=postgresql://interlock:...@...cockroachlabs.cloud:26257/defaultdb?sslmode=verify-full
CCLOUD_API_KEY=...

# AWS
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
```

## Checklist

- [ ] Bedrock model access granted (Haiku 4.5, Sonnet 5, Titan Embeddings V2)
- [ ] CockroachDB cluster created on **AWS us-east-1**, version **≥ 25.2** confirmed
- [ ] `DATABASE_URL` in `.env.local`
- [ ] `CCLOUD_API_KEY` in `.env.local`
- [ ] AWS keys in `.env.local`
- [ ] $20 budget alarm set
- [ ] Public GitHub repo created, empty
- [ ] Told me: version number, cluster ID, repo URL

---

## What I'm building while you do this

None of the following needs your credentials, so I'm starting immediately:

- The landing page (responsive, dark/light, fully annotated)
- The database schema and migrations
- The agent runtime and adjudicator logic
- The benchmark harness
- Terraform for the AWS side

The moment `.env.local` exists, I can run migrations and light the whole thing up.
