"use client";

import { verifyForgotPasswordSchema } from "@/backend/schemas/verifyForgotPasswordSchema";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import { ApiResponse } from "@/types/ApiResponse";
import { zodResolver } from "@hookform/resolvers/zod";
import axios, { AxiosError } from "axios";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { use, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import * as z from "zod";

function VerifyForgotPassword({
  searchParams,
}: {
  searchParams: Promise<{
    identifier: string;
    verifyCode: number;
  }>;
}) {
  const { data: session } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (session && session.user) {
      router.push("/dashboard");
      return;
    }
  }, [session, router]);

  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  const { identifier, verifyCode } = use(searchParams);

  useEffect(() => {
    if (identifier) {
      form.setValue("identifier", identifier);
    }

    if (verifyCode) {
      form.setValue("verifyCode", Number(verifyCode));
    }
  }, [identifier, verifyCode]);

  const form = useForm<z.infer<typeof verifyForgotPasswordSchema>>({
    resolver: zodResolver(verifyForgotPasswordSchema),
    defaultValues: {
      identifier: identifier || "",
      verifyCode: verifyCode ? Number(verifyCode) : undefined,
      password: "",
      confirmPassword: "",
    },
  });

  const watchFields = form.watch([
    "password",
    "confirmPassword",
    "verifyCode",
    "identifier",
  ]);
  const isButtonDisabled =
    watchFields.some((field) => !field) ||
    watchFields[0] !== watchFields[1] ||
    loading;

  useEffect(() => {
    if (watchFields.some((field) => !field)) {
      setError("Please fill all the fields");
    } else if (watchFields[0] !== watchFields[1]) {
      setError("Passwords do not match");
    } else {
      setError("");
    }
  }, [watchFields]);

  const onSubmit = async (data: z.infer<typeof verifyForgotPasswordSchema>) => {
    setLoading(true);

    try {
      const response = await axios.post("/api/verify-forgot-password", {
        verifyCode: Number(data.verifyCode),
        identifier: data.identifier,
        password: data.password,
      });

      toast({
        title: "Success",
        description: response.data.message || "Password reset successfully",
      });

      router.replace(`/sign-in?identifier=${data.identifier}`);
    } catch (error) {
      console.error("Error in resetting password", error);

      const axiosError = error as AxiosError<ApiResponse>;

      const errorMessage =
        axiosError.response?.data.message ||
        "Some error occurred. Please try again later";

      toast({
        title: "Password Reset Failed",
        description: errorMessage,
        variant: "destructive",
      });

      if (
        errorMessage === "No user found with this username or email" ||
        errorMessage === "New password cannot be the same as the old password"
      ) {
        router.replace(`/sign-up?identifier=${data.identifier}`);
      }
    } finally {
      setLoading(false);
      form.reset();
    }
  };

  return (
    <main className="auth-page flex items-center justify-center">
      <div className="auth-card w-full space-y-6">
        <div className="text-center">
          <h1 className="mb-4">
            Forgot Your Password
          </h1>
        </div>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <FormField
              control={form.control}
              name="identifier"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Username or Email
                  </FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Enter the username or email"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="verifyCode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Verification Code
                  </FormLabel>
                  <FormControl>
                    <Input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      autoComplete="one-time-code"
                      maxLength={6}
                      placeholder="Enter the code sent to your email"
                      {...field}
                      // verifyForgotPasswordSchema requires z.number(); without
                      // this coercion the field holds a string and every manual
                      // submission fails with "Expected number, received string".
                      onChange={(e) => {
                        const digits = e.target.value.replace(/\D/g, "").slice(0, 6);
                        field.onChange(digits === "" ? undefined : Number(digits));
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    New Password
                  </FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      placeholder="Enter your new password"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="confirmPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Confirm Password
                  </FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      placeholder="Enter your Confirm password"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <p className="text-destructive dark:text-red-400 flex justify-center w-full">
              {error}
            </p>

            <Button
              type="submit"
              className="auth-submit-button w-full"
              disabled={isButtonDisabled}
            >
              {loading ? "Submitting..." : "Submit"}
            </Button>
          </form>
        </Form>
      </div>
    </main>
  );
}

export default VerifyForgotPassword;
