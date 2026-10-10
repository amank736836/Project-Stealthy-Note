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

export async function sendVerificationEmail({
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
  const verificationUrl = new URL("/verify", baseUrl);
  verificationUrl.searchParams.set("identifier", username);
  verificationUrl.searchParams.set("verifyCode", String(verifyCode));
  const safeVerificationUrl = escapeHtml(verificationUrl.toString());
  const Mail = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Email Verification</title>
    <style>
        body {
            font-family: 'Arial', sans-serif;
            background-color: #f8f9fa;
            margin: 0;
            padding: 0;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
        }
        .email-container {
            max-width: 600px;
            background: #ffffff;
            padding: 20px;
            border-radius: 10px;
            box-shadow: 0 4px 10px rgba(0, 0, 0, 0.1);
            text-align: center;
            border: 1px solid #ddd;
        }
        .header {
            font-size: 24px;
            font-weight: bold;
            color: #007bff;
            margin-bottom: 10px;
        }
        .content {
            font-size: 16px;
            color: #333;
            line-height: 1.6;
            margin-bottom: 20px;
        }
        .verification-code {
            font-size: 20px;
            font-weight: bold;
            color: #28a745;
            background: #eaf7ea;
            padding: 10px;
            display: inline-block;
            border-radius: 5px;
            margin: 15px 0;
            letter-spacing: 1.5px;
        }
        .verify-button {
            display: inline-block;
            background-color: #007bff;
            color: white;
            padding: 12px 25px;
            border-radius: 5px;
            text-decoration: none;
            font-weight: bold;
            margin-top: 10px;
        }
        .footer {
            margin-top: 20px;
            font-size: 12px;
            color: #777;
        }
    </style>
</head>
<preview>Verify Your Email</preview>
<body>
    <div class="email-container">
        <div class="header">Verify Your Email</div>
        <div class="content">
            <p>Hello, ${safeUsername}</p>
            <p>Thank you for signing up! Please confirm your email address by using the verification code below:</p>
            <div class="verification-code">${verifyCode}</div>
            <p>Alternatively, you can click the button below to verify your email:</p>
            <a href="${safeVerificationUrl}"
             class="verify-button">Verify Email</a>
            <p>If you did not create an account, you can safely ignore this email.</p>
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
      subject: `Stealthy Note - Verification Code for ${username}`,
      text: `Verification code: ${verifyCode}`,
      html: Mail,
    };

    const response = await transporter.sendMail(mailOptions);

    console.log("Verification email sent", response);

    if (response.rejected.length > 0) {
      console.error("Failed to send verification email", response.rejected);
      return {
        success: false,
        message: "Failed to send verification email",
      };
    }

    return Promise.resolve({
      success: true,
      message: "Verification email send successfully",
    });
  } catch (error) {
    console.error("Failed to send verification email", error);
    return {
      success: false,
      message: "Failed to send verification email",
    };
  }
}
