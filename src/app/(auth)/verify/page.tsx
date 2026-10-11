"use client";

import { userVerifySchema } from "@/backend/schemas/userVerifySchema";
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
import { Loader2 } from "lucide-react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { use, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import * as z from "zod";

function VerifyAccount({
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

  const { identifier, verifyCode } = use(searchParams);

  useEffect(() => {
    if (identifier) {
      form.setValue("identifier", identifier);
    }

    if (verifyCode) {
      form.setValue("verifyCode", Number(verifyCode));
    }
  }, [identifier, verifyCode]);

  const form = useForm<z.infer<typeof userVerifySchema>>({
    resolver: zodResolver(userVerifySchema),
    defaultValues: {
      identifier: identifier || "",
      verifyCode: verifyCode ? Number(verifyCode) : undefined,
    },
  });

  const watchFields = form.watch(["identifier", "verifyCode"]);
  const isButtonDisabled = watchFields.some((field) => !field) || loading;

  const onSubmit = async (data: z.infer<typeof userVerifySchema>) => {
    try {
      setLoading(true);
      const response = await axios.post("/api/verifyCode", {
        identifier: data.identifier,
        verifyCode: Number(data.verifyCode),
      });

      toast({
        title: "Success",
        description: response.data.message || "User verified successfully",
      });

      router.replace(`/sign-in?identifier=${data.identifier}`);
    } catch (error) {
      console.error("Error in verifying user", error);

      const axiosError = error as AxiosError<ApiResponse>;

      const errorMessage =
        axiosError.response?.data.message ||
        "Some error occurred. Please try again later";

      toast({
        title: "Verification Failed",
        description: errorMessage,
        variant: "destructive",
      });

      if (errorMessage === "User is already verified") {
        toast({
          title: "Already Verified",
          description: "Redirecting to login...",
        });
        setTimeout(() => {
          router.replace(`/sign-in?identifier=${data.identifier}`);
        }, 1500);
      }
    } finally {
      form.reset();
      setLoading(false);
    }
  };

  return (
    <main className="auth-page flex items-center justify-center">
      <div className="auth-card w-full space-y-6">
        <div className="text-center">
          <h1 className="mb-4">
            Verify Your Account
          </h1>
          <p className="text-muted-foreground">
            Enter the verification code sent to your email
          </p>
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
                      placeholder="Enter your username or email"
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
                      placeholder="Verification Code"
                      {...field}
                      // Digits only. The old type="number" let `1e5` through as
                      // 100000 and turned a cleared field into 0.
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
            <Button
              type="submit"
              className="auth-submit-button w-full"
              disabled={isButtonDisabled || loading}
            >
              {loading ? (
                <>
                  <Loader2 className="animate-spin h-4 w-4" />
                  Verifying...
                </>
              ) : (
                "Submit"
              )}
            </Button>
          </form>
        </Form>
      </div>
    </main>
  );
}

export default VerifyAccount;
