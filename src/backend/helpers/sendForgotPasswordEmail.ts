import { ApiResponse } from "@/types/ApiResponse";
import nodemailer from "nodemailer";

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] as string);

const transporter = nodemailer.createTransport({
  service: "gmail",
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  auth: {
    user: process.env.Node_Mailer_Email,
    pass: process.env.Node_Mailer_Password,
  },
});

export async function sendForgotPasswordEmail({
  email,
  username,
  verifyCode,
  baseUrl,
}: {
  email: string;
  username: string;
  verifyCode: number;
  baseUrl: string;
}): Promise<ApiResponse> {
  const safeUsername = escapeHtml(username);
  const resetUrl = new URL("/verify-forgot-password", baseUrl);
  resetUrl.searchParams.set("identifier", email);
  resetUrl.searchParams.set("verifyCode", String(verifyCode));
  const safeResetUrl = escapeHtml(resetUrl.toString());
  const Mail = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Forgot Your Password
    </title>
    <style>
        body {
            font-family: 'Arial', sans-serif;
            background-color: #f4f4f4;
            margin: 0;
            padding: 20px;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
        }
        .email-container {
            max-width: 600px;
            background: #ffffff;
            padding: 25px;
            border-radius: 10px;
            box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1);
            text-align: center;
            border: 1px solid #ddd;
        }
        .header {
            font-size: 26px;
            font-weight: bold;
            color: #dc3545;
            margin-bottom: 15px;
        }
        .content {
            font-size: 16px;
            color: #333;
            line-height: 1.6;
        }
        .verification-code {
            font-size: 22px;
            font-weight: bold;
            color: #28a745;
            background: #eaf7ea;
            padding: 12px;
            display: inline-block;
            border-radius: 8px;
            margin: 15px 0;
            letter-spacing: 2px;
        }
        .forgot-button {
            display: inline-block;
            background-color: #dc3545;
            color: white;
            padding: 14px 30px;
            border-radius: 5px;
            text-decoration: none;
            font-weight: bold;
            font-size: 16px;
            margin-top: 15px;
            transition: background 0.3s;
        }
        .forgot-button:hover {
            background-color: #c82333;
        }
        .footer {
            margin-top: 20px;
            font-size: 13px;
            color: #777;
        }
        @media screen and (max-width: 600px) {
            .email-container {
                width: 90%;
                padding: 20px;
            }
            .header {
                font-size: 22px;
            }
            .verification-code {
                font-size: 18px;
                padding: 10px;
            }
            .forgot-button {
                font-size: 14px;
                padding: 12px 25px;
            }
        }
    </style>
</head>
<preview>Forgot Your Password</preview>
<body>
    <div class="email-container">
        <div class="header">Forgot Your Password</div>
        <div class="content">
            <p>Hello, <strong>${safeUsername}</strong>,</p>
            <p>We received a request to forgot your password. Use the verification code below to proceed:</p>
            <div class="verification-code">${verifyCode}</div>
            <p>Or, click the button below to forgot your password instantly:</p>
            <a href="${safeResetUrl}"
            class="forgot-button">Forgot Password</a>
            <p>If you did not request this, you can safely ignore this email.</p>
        </div>
        <div class="footer">&copy; ${new Date().getFullYear()} Stealthy Note. All rights reserved.</div>
    </div>
</body>
</html>

    `;

  try {
    const mailOptions = {
      from: `Stealthy Note<${process.env.Node_Mailer_Email}>`,
      to: email,
      subject: `Stealthy Note - Forgot Your Password for ${username}`,
      text: `Forgot Your Password - Verification Code: ${verifyCode}`,
      html: Mail,
    };

    const response = await transporter.sendMail(mailOptions);

    console.log("Forgot password code - Email sent successfully", response);

    if (response.rejected.length > 0) {
      console.error(
        "Failed to send forgot password code - Email",
        response.rejected
      );
      return {
        success: false,
        message: "Failed to send forgot password code - Email",
      };
    }

    return Promise.resolve({
      success: true,
      message: "Forgot password code - Email sent successfully",
    });
  } catch (error) {
    console.error("Failed to send forgot password code - Email", error);
    return {
      success: false,
      message: "Failed to send forgot password code - Email",
    };
  }
}
