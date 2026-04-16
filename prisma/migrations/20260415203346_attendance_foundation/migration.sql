-- CreateEnum
CREATE TYPE "AttendanceSource" AS ENUM ('DASHBOARD', 'KIOSK');

-- AlterTable
ALTER TABLE "AttendanceRecord" ADD COLUMN     "source" "AttendanceSource" NOT NULL DEFAULT 'DASHBOARD';

-- AlterTable
ALTER TABLE "BookingPolicy" ADD COLUMN     "checkInClosesMinutesAfter" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "checkInOpensMinutesBefore" INTEGER NOT NULL DEFAULT 15;
