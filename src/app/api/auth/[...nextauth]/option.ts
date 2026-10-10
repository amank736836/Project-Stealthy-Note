import { sendVerificationEmail } from "@/backend/helpers/sendVerificationEmail";
import dbConnect from "@/backend/lib/dbConnect";
import UserModel from "@/backend/model/User";
import bcrypt from "bcryptjs";
import NextAuth, { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { randomInt } from "node:crypto";

const authOptions: NextAuthConfig = {
  providers: [
    Credentials({
      id: "credentials",
      name: "Credentials",
      credentials: {
        baseUrl: {
          label: "Base URL",
          type: "text",
          placeholder: "Base URL",
        },
        identifier: {
          label: "Username or Email",
          type: "text",
          placeholder: "Username or Email",
        },
        password: {
          label: "Password",
          type: "text",
          placeholder: "Password",
        },
      },
      async authorize(credentials): Promise<any> {
        if (!credentials.baseUrl) {
          throw new Error("Base URL is required");
        }

        if (!credentials.identifier) {
          throw new Error("Username or Email is required");
        }

        if (!credentials.password) {
          throw new Error("Password is required");
        }

        await dbConnect();
        try {
          const user = await UserModel.findOne({
            $or: [
              { email: credentials.identifier },
              { username: credentials.identifier },
            ],
          });

          const baseUrl = credentials.baseUrl as string;

          if (!user) {
            throw new Error("No user found with this username or email");
          }

          const isValid = await bcrypt.compare(
            credentials.password as string,
            user.password
          );

          if (!isValid) {
            throw new Error("Invalid password");
          }

          if (!user.isVerified) {
            if (user.verifyCodeExpiry < new Date()) {
              const verifyCode = randomInt(100000, 1000000);

              const verifyCodeExpiry = new Date();
              verifyCodeExpiry.setHours(verifyCodeExpiry.getHours() + 1);

              user.verifyCode = verifyCode;
              user.verifyCodeExpiry = verifyCodeExpiry;

              await user.save();

              const emailResponse = await sendVerificationEmail({
                baseUrl,
                email: user.email,
                username: user.username,
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

              throw new Error(
                "User is not verified and Verification code expired. New verification code sent to your email"
              );
            } else {
              throw new Error("Please verify your account before logging in");
            }
          }

          return {
            _id: user._id,
            isVerified: user.isVerified,
            isAcceptingMessages: user.isAcceptingMessage,
            username: user.username,
          };
        } catch (error) {
          throw new Error(`Error in authorize: ${error}`);
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token._id = user._id.toString();
        token.isVerified = user.isVerified;
        token.isAcceptingMessages = user.isAcceptingMessages;
        token.username = user.username;
      }

      return token;
    },
    async session({ session, token }) {
      if (token) {
        session.user._id = token._id as string;
        session.user.isVerified = token.isVerified as boolean;
        session.user.isAcceptingMessages = token.isAcceptingMessages as boolean;
        session.user.username = token.username as string;
      }
      return session;
    },
    authorized: async ({ auth }) => {
      return !!auth;
    },
  },
  pages: {
    signIn: "/sign-in",
    error: "/sign-in",
  },
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60,
  },
  secret: process.env.AUTH_SECRET,
};

export const { handlers, auth } = NextAuth(authOptions);
