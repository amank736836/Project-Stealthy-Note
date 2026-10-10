import dbConnect from "@/backend/lib/dbConnect";
import UserModel from "@/backend/model/User";
import bcrypt from "bcryptjs";
import { randomInt } from "node:crypto";

export async function POST(request: Request) {
  const { identifier, verifyCode, password } = await request.json();

  if (!identifier) {
    return Response.json(
      {
        success: false,
        message: "Identifier is required",
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

  if (!password) {
    return Response.json(
      {
        success: false,
        message: "New Password is required",
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
      throw new Error("No user found with this username or email");
    }

    if (user.verifyCode !== verifyCode) {
      return Response.json(
        {
          success: false,
          message: "Invalid code",
        },
        {
          status: 400,
        }
      );
    }

    if (user.verifyCodeExpiry < new Date()) {
      return Response.json(
        {
          success: false,
          message: "Verification code expired. Please request a new one",
        },
        {
          status: 400,
        }
      );
    }

    if (user.isVerified === false) {
      user.isVerified = true;
    }

    user.verifyCode = randomInt(100000, 1000000);
    user.verifyCodeExpiry = new Date(-1);

    const match = await bcrypt.compare(password, user.password);

    if (match) {
      return Response.json(
        {
          success: false,
          message: "New password cannot be the same as the old password",
        },
        {
          status: 400,
        }
      );
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    user.password = hashedPassword;

    await user.save();

    return Response.json(
      {
        success: true,
        message: "Password updated successfully",
      },
      {
        status: 200,
      }
    );
  } catch (error) {
    return Response.json(
      {
        success: false,
        message: `Error in setting new password: ${error}`,
      },
      {
        status: 500,
      }
    );
  }
}
