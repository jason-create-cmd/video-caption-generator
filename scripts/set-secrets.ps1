param(
  [Parameter(Mandatory = $true)]
  [string]$SonioxApiKey,

  [Parameter(Mandatory = $true)]
  [string]$AdminPassword,

  [Parameter(Mandatory = $true)]
  [string]$R2AccessKeyId,

  [Parameter(Mandatory = $true)]
  [string]$R2SecretAccessKey
)

$ErrorActionPreference = "Stop"

function Set-WranglerSecret {
  param(
    [string]$Name,
    [string]$Value
  )

  $Value | npx wrangler secret put $Name
}

$sessionSecret = [Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
$webhookSecret = [Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))

Set-WranglerSecret -Name "SONIOX_API_KEY" -Value $SonioxApiKey
Set-WranglerSecret -Name "ADMIN_PASSWORD" -Value $AdminPassword
Set-WranglerSecret -Name "SESSION_SECRET" -Value $sessionSecret
Set-WranglerSecret -Name "WEBHOOK_SECRET" -Value $webhookSecret
Set-WranglerSecret -Name "R2_ACCESS_KEY_ID" -Value $R2AccessKeyId
Set-WranglerSecret -Name "R2_SECRET_ACCESS_KEY" -Value $R2SecretAccessKey

Write-Host "Wrangler secrets configured."
