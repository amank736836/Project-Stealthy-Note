import { sendVerificationEmail } from "@/backend/helpers/sendVerificationEmail";
import dbConnect from "@/backend/lib/dbConnect";
import UserModel from "@/backend/model/User";
import { randomInt } from "node:crypto";

export async function POST(request: Request) {
  const { identifier, verifyCode } = await request.json();

  if (!identifier) {
    return Response.json(
      {
        success: false,
        message: "Username is required",
      },
      {
        status: 400,
      }
    );
  }

  if (!verifyCode) {
    return Response.json(
      {
        success: false,
        message: "Verification code is required",
      },
      {
        status: 400,
      }
    );
  }

  const decodedIdentifier = decodeURIComponent(identifier);

  await dbConnect();

  try {
    const user = await UserModel.findOne({
      $or: [{ email: decodedIdentifier }, { username: decodedIdentifier }],
    });

    if (!user) {
      return Response.json(
        {
          success: false,
          message: "Invalid Username",
        },
        {
          status: 400,
        }
      );
    }

    if (user.isVerified) {
      return Response.json(
        {
          success: false,
          message: "User is already verified",
        },
        {
          status: 400,
        }
      );
    }

    const isVerifyCodeValid = user.verifyCode === verifyCode;

    const isVerifyCodeNotExpired = new Date(user.verifyCodeExpiry) > new Date();

    if (isVerifyCodeValid && isVerifyCodeNotExpired) {
      user.verifyCode = randomInt(100000, 1000000);
      user.verifyCodeExpiry = new Date(-1);
      user.isVerified = true;
      await user.save();
      return Response.json(
        {
          success: true,
          message: "User Verified Successfully",
        },
        {
          status: 200,
        }
      );
    } else if (isVerifyCodeValid && !isVerifyCodeNotExpired) {
      user.verifyCode = randomInt(100000, 1000000);

      const verifyCodeExpiry = new Date();
      verifyCodeExpiry.setHours(verifyCodeExpiry.getHours() + 1);

      user.verifyCodeExpiry = verifyCodeExpiry;

      const baseUrl = `${request.headers.get("origin")}`;

      const emailResponse = await sendVerificationEmail({
        baseUrl,
        email: user.email,
        username: user.username,
        verifyCode: user.verifyCode,
      });

      if (!emailResponse.success) {
        return Response.json(
          {
            success: false,
            message: `Failed to send verification email: ${emailResponse.message}`,
          },
          {
            status: 500,
          }
        );
      }

      return Response.json(
        {
          success: false,
          message:
            "Verification code expired. New verification code sent to your email",
        },
        {
          status: 400,
        }
      );
    } else {
      return Response.json(
        {
          success: false,
          message: "Invalid Code",
        },
        {
          status: 400,
        }
      );
    }
  } catch (error) {
    console.error("Error Verifying User", error);
    return Response.json(
      {
        success: false,
        message: "Error Verifying User",
      },
      {
        status: 400,
      }
    );
  }
}
