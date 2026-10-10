import { sendVerificationEmail } from "@/backend/helpers/sendVerificationEmail";
import dbConnect from "@/backend/lib/dbConnect";
import UserModel from "@/backend/model/User";
import bcrypt from "bcryptjs";
import { randomInt } from "node:crypto";

export async function POST(request: Request) {
  const { email, username, password } = await request.json();

  if (!email) {
    return Response.json(
      {
        success: false,
        message: "Email is required",
      },
      {
        status: 400,
      }
    );
  }

  if (!username) {
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

  if (!password) {
    return Response.json(
      {
        success: false,
        message: "Password is required",
      },
      {
        status: 400,
      }
    );
  }

  await dbConnect();

  try {
    const existingUserVerifiedByUsername = await UserModel.findOne({
      username,
      isVerified: true,
    });

    if (existingUserVerifiedByUsername) {
      return Response.json(
        {
          success: false,
          message: "Username already exists",
        },
        {
          status: 400,
        }
      );
    }

    const existingUserByEmail = await UserModel.findOne({
      email,
    });

    const verifyCode = randomInt(100000, 1000000);

    const verifyCodeExpiry = new Date();
    verifyCodeExpiry.setHours(verifyCodeExpiry.getHours() + 1);

    const hashedPassword = await bcrypt.hash(password, 10);

    if (existingUserByEmail) {
      if (existingUserByEmail.isVerified) {
        return Response.json(
          {
            success: false,
            message: "User already exists with this email",
          },
          {
            status: 400,
          }
        );
      } else {
        existingUserByEmail.username = username;
        existingUserByEmail.password = hashedPassword;

        existingUserByEmail.verifyCode = verifyCode;
        existingUserByEmail.verifyCodeExpiry = verifyCodeExpiry;

        await existingUserByEmail.save();
      }
    } else {
      await UserModel.create({
        username,
        email,
        password: hashedPassword,
        verifyCode,
        verifyCodeExpiry,
        messages: [],
      });
    }

    const baseUrl = `${request.headers.get("origin")}`;

    const emailResponse = await sendVerificationEmail({
      baseUrl,
      email,
      username,
      verifyCode,
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
        success: true,
        message: "User registered successfully. Please verify your email",
      },
      {
        status: 201,
      }
    );
  } catch (error) {
    console.error("Error in POST /api/sign-up", error);
    return Response.json(
      {
        success: false,
        message: "Error Registering User",
      },
      {
        status: 500,
      }
    );
  }
}
